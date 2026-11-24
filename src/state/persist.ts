// Autosave (document → localStorage, music → IndexedDB) and file IO.

import { getState, useStore } from './store'
import { parseProjectFile, toProjectFile } from '@/core/serialize'
import { bytesToBase64, base64ToBytes } from '@/core/sample'
import { exportCsvZip } from '@/core/export'
import type { AudioMeta, ShowDoc } from '@/core/types'
import { audioContext } from './playback'
import { waveformPeaks } from '@/core/beats'
import { detectBeatsAsync, renderMusicAsync } from '@/engine/client'

const DOC_KEY = 'dsd.doc.v1'

export function loadAutosave(): ShowDoc | null {
  try {
    const text = localStorage.getItem(DOC_KEY)
    return text ? parseProjectFile(text).doc : null
  } catch {
    return null
  }
}

export function startAutosave() {
  let timer = 0
  useStore.subscribe((s, prev) => {
    if (s.doc === prev.doc) return
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DOC_KEY, JSON.stringify(s.doc))
      } catch {
        getState().toast('Autosave failed: browser storage is full. Save the project to a file.', 'err')
      }
    }, 400)
  })
}

// --- IndexedDB (music) -----------------------------------------------------------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dsd', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(key: string, value: unknown) {
  const db = await idb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite')
    tx.objectStore('files').put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('files').objectStore('files').get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbDelete(key: string) {
  const db = await idb()
  await new Promise<void>((resolve) => {
    const tx = db.transaction('files', 'readwrite')
    tx.objectStore('files').delete(key)
    tx.oncomplete = () => resolve()
  })
}

// --- Music -------------------------------------------------------------------------

function mixdown(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / buffer.numberOfChannels
  }
  return out
}

async function decode(bytes: ArrayBuffer, mime: string) {
  const buffer = await audioContext().decodeAudioData(bytes.slice(0))
  const mono = mixdown(buffer)
  const peaks = waveformPeaks(mono, Math.max(200, Math.min(40000, Math.ceil(buffer.duration * 60))))
  return { buffer, mono, peaks, runtime: { buffer, peaks, bytes, mime } }
}

/** Load music, detect beats, and attach it to the show (undoable). */
export async function loadMusic(bytes: ArrayBuffer, mime: string, name: string) {
  const s = getState()
  let decoded
  try {
    decoded = await decode(bytes, mime)
  } catch {
    s.toast('Could not read that audio file. Try MP3, WAV, OGG or M4A.', 'err')
    return
  }
  s.set({ audio: decoded.runtime })
  s.toast('Analysing beats…')
  const result = await detectBeatsAsync(decoded.mono, decoded.buffer.sampleRate)
  const offset = getState().doc.audio?.offset ?? 0
  getState().update((d) => {
    d.audio = {
      name, duration: decoded.buffer.duration, offset,
      beats: result.beats.map((b) => Math.round(b * 1000) / 1000),
      downbeat: result.downbeat, bpm: Math.round(result.bpm * 10) / 10, energy: result.energy,
      bass: result.bass, bright: result.bright, accents: result.accents, sections: result.sections,
    }
  }, 'Add music')
  const parts = result.sections.length > 1 ? `, ${result.sections.length} sections (${result.sections.map((x) => x.label).join(' · ')})` : ''
  getState().toast(result.beats.length ? `Music added · ${Math.round(result.bpm)} BPM, ${result.beats.length} beats${parts}` : 'Music added (no clear beat found)')
  void idbPut('audio', { bytes, mime, name }).catch(() => {})
}

export async function removeMusic() {
  getState().set({ audio: null })
  getState().update((d) => { d.audio = null }, 'Remove music')
  await idbDelete('audio').catch(() => {})
}

/** What generated music sounds like is fully given by its recipe. */
const recipeKey = (m: AudioMeta) => `${m.generated}|${m.bpm}|${m.duration}|${(m.sections ?? []).map((x) => `${x.label}@${x.start}`).join(',')}`
let renderedKey = ''
let inflightKey = ''

/**
 * Generated music (a score composed by the editor) is stored as its recipe,
 * not as audio: render it in the worker and attach it.
 */
export async function attachGeneratedMusic(): Promise<boolean> {
  const meta = getState().doc.audio
  if (!meta?.generated) return false
  const key = recipeKey(meta)
  if (key === inflightKey || (key === renderedKey && getState().audio)) return true
  inflightKey = key
  try {
    const { pcm, sampleRate } = await renderMusicAsync(meta)
    const now = getState().doc.audio
    if (!now?.generated || recipeKey(now) !== key) return true
    const ctx = audioContext()
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
    buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
    getState().set({ audio: { buffer, peaks: waveformPeaks(pcm, 4000), bytes: new ArrayBuffer(0), mime: GENERATED_MIME } })
    renderedKey = key
  } catch (err) {
    getState().toast(`Could not generate the score: ${err instanceof Error ? err.message : String(err)}`, 'err')
  } finally {
    if (inflightKey === key) inflightKey = ''
  }
  return true
}

const GENERATED_MIME = 'audio/x-generated'

/**
 * Keep the playing audio in step with the document: a composed score is
 * (re)rendered whenever its recipe changes — compose, recompose, undo, redo —
 * and undoing back to a loaded song brings that song back.
 */
export function startMusicSync() {
  useStore.subscribe((s, prev) => {
    if (s.doc.audio === prev.doc.audio) return
    const m = s.doc.audio
    if (m?.generated) {
      if (recipeKey(m) !== renderedKey || !s.audio) void attachGeneratedMusic()
    } else if (s.audio?.mime === GENERATED_MIME) {
      renderedKey = ''
      getState().set({ audio: null })
      void restoreMusic()
    }
  })
}

/** Restore music saved in a previous session (if it matches the show). */
export async function restoreMusic() {
  const meta = getState().doc.audio
  if (!meta) return
  if (meta.generated) { await attachGeneratedMusic(); return }
  try {
    const saved = await idbGet<{ bytes: ArrayBuffer; mime: string; name: string }>('audio')
    if (!saved || saved.name !== meta.name) return
    const decoded = await decode(saved.bytes, saved.mime)
    getState().set({ audio: decoded.runtime })
  } catch {
    /* music simply stays unloaded */
  }
}

// --- Files ---------------------------------------------------------------------------

export function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function safeName(name: string): string {
  return name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'show'
}

export function saveProject() {
  const s = getState()
  // Generated music is saved as its recipe (regenerated on open), not as audio.
  const audio = s.audio && s.doc.audio && !s.doc.audio.generated ? { mime: s.audio.mime, data: bytesToBase64(new Uint8Array(s.audio.bytes)) } : null
  download(JSON.stringify(toProjectFile(s.doc, audio)), `${safeName(s.doc.name)}.droneshow.json`, 'application/json')
  s.toast(audio || s.doc.audio?.generated ? 'Project saved (music included)' : 'Project saved')
}

export async function openProjectFile(file: File) {
  const s = getState()
  try {
    const { doc, audio } = parseProjectFile(await file.text())
    s.loadDoc(doc)
    s.set({ audio: null })
    if (doc.audio?.generated) void attachGeneratedMusic()
    else if (audio && doc.audio) {
      const bytes = base64ToBytes(audio.data).buffer as ArrayBuffer
      const decoded = await decode(bytes, audio.mime)
      getState().set({ audio: decoded.runtime })
      void idbPut('audio', { bytes, mime: audio.mime, name: doc.audio.name }).catch(() => {})
    }
    s.toast(`Opened “${doc.name}”`)
  } catch (err) {
    s.toast(err instanceof Error ? err.message : 'Could not open that file.', 'err')
  }
}

export function exportCsv(rate: number) {
  const s = getState()
  if (!s.compiled) return
  const zip = exportCsvZip(s.compiled, { rate }, s.doc.name)
  download(zip as BlobPart, `${safeName(s.doc.name)}-trajectories.zip`, 'application/zip')
  s.toast(`Exported ${s.compiled.n} drone trajectories`)
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}
