// The copilot: a conversational agent that edits the show with tools.
//
// It runs in the browser (its tools act on the editor's in-memory show), as a
// streaming tool-use loop on the Messages API:
//   • text and thinking summaries stream into the chat as they arrive;
//   • every tool input is validated before it runs; a turn cut off by
//     max_tokens or declined (refusal) never runs its tools;
//   • API history is append-only (thinking blocks are passed back unchanged);
//   • all edits made during one user request collapse into one undo step.

import Anthropic from '@anthropic-ai/sdk'
import { COLOUR_GUIDE, PICTURE_GUIDE } from './guides'
import type { BetaMessageParam, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { useCopilot, type ChatItem } from './copilotStore'

export { useCopilot, STARTERS, type ChatItem } from './copilotStore'
import { getState } from '@/state/store'
import { asParams, baseParams, describeError, eagerStreaming, echoContent, getClient, recordUsage, AiNotConfigured } from './client'
import { tracked } from './costs'
import { summarizeShow } from './context'
import { runTool, toolDefinitions, toolLabel } from './tools'

export const COPILOT_SYSTEM = `You are the copilot inside Drone Show Designer, a web editor that small agencies and drone operators use to design drone light shows and preview them for clients.

How the editor works
- A show is: takeoff from a ground grid → a sequence of scenes (formations held for a while, with flights between them) → return and land. Every drone takes part in every scene; spare drones can be parked with lights off.
- Formations face the audience. Coordinates are metres: x across, altitude up, z toward the audience.
- The engine owns safety: it sizes every formation to safe spacing, assigns drones to points so flights don't collide, computes the fastest safe flight times, and checks everything exactly. Your tools go through it, and each tool result ends with the current safety status.
- Light has two layers: each scene's base light effect, plus light cues on their own timeline track that play over every drone (flashes, washes, sweeps), during formations and flights alike.
- With music, the song is the backbone. get_music gives its sections (intro, verse, build, drop, break, outro), accents and bars. land_on_music puts a formation exactly on a section or bar (e.g. the hero shape on the drop); fit_to_song makes the finale end with the song; align_to_music lands every arrival on a downbeat; light_the_music lights the whole show from the song's structure (then add a few signature cues of your own). Without a song, compose_score writes an original score to the show with drops on the hero formations you choose. Lights can react to the music: effect "react" (brightness follows loudness), "meter", and flash with on_accents.

How to work
- The user's message starts with <show_state>, a snapshot of the show at that moment; use the ids from it.
- Make changes with tools rather than describing what you would do. If a request is genuinely ambiguous, or would replace most of the show, ask one short question first.
- When looks matter (text readability, custom drawings, colour choices) or when asked for a review, use look_at_scenes. For 3D objects, create them with shape kind model3d, check them from all sides (look_at_scenes with all_angles), and use improve_3d_model to look and fix.
- You can reach everything the editor can do: formations (add_scene incl. LED signs, extra_shapes and keyframes, add_shape/remove_shape for multi-shape formations, set_shape, set_light, edit_scene), moving parts (set_motion makes any shape swing, turn or slide on its own; edit_3d_model adjusts a model's moving parts and relief), drawings and traced pictures (edit_picture: lines / filled / adaptive style, detail, line sensitivity, or a new picture), groups, cues, music, show-wide settings (set_show: fleet limits, airspace, takeoff, landing, flight home, music start), the real site (set_site: accuracy, location, heading, keep-out zones, flight area), the wind test (wind_test) and the preview (show_moment: select a formation, move the playhead, switch the camera, play). After a visible change, show_moment the result so the user sees it.
- Leave the show safe: if a tool result reports safety issues, fix them (fix_safety, or adjust) before you finish, and never say the show is safe unless the latest safety line says all checks pass.
- Creative direction: contrast between consecutive scenes (shape, colour, scale); recognisable shapes; short text, since drones are metres apart and long words become unreadable; 3D shapes look best spinning slowly; long holds can breathe, bob or sway gently; spare drones can become a starfield, halo, frame or base instead of sitting dark; key flights can use spectacle transitions (cascade, swirl, burst, ant walk, rain) at the cost of time; a scene can split into groups that fly their own formations at their own pace and merge in the next scene (split_scene, add_group_step, edit_group; group formations are scenes too, edit them with edit_scene / set_shape / set_light); text can be written on, typed or flipped, and LED signs scroll dot-matrix text; the biggest, brightest moment belongs to the finale; flashes belong on musical accents and quiet passages stay calm.

${PICTURE_GUIDE}

${COLOUR_GUIDE}

- Your replies appear in a narrow chat panel beside the editor, and the user sees each tool call as a card. Keep replies short: what you changed, and anything they should decide. Plain sentences or short lists, no headings.`

let seq = 0
const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`

function add(item: ChatItem) {
  useCopilot.setState((s) => ({ items: [...s.items, item] }))
}
function patch(id: string, f: (it: ChatItem) => ChatItem) {
  useCopilot.setState((s) => ({ items: s.items.map((it) => (it.id === id ? f(it) : it)) }))
}
function remove(id: string) {
  useCopilot.setState((s) => ({ items: s.items.filter((it) => it.id !== id) }))
}
function appendMessage(m: BetaMessageParam) {
  useCopilot.setState((s) => ({ messages: [...s.messages, m] }))
}

export function newChat() {
  useCopilot.getState().controller?.abort()
  useCopilot.setState({ items: [], messages: [], running: false, controller: null })
}

export function stopCopilot() {
  useCopilot.getState().controller?.abort()
}

const MAX_STEPS = 20

export async function sendToCopilot(text: string): Promise<void> {
  const prompt = text.trim()
  if (!prompt || useCopilot.getState().running) return
  let client: Anthropic
  try {
    client = getClient()
  } catch (err) {
    add({ kind: 'notice', id: uid(), text: describeError(err), tone: 'error' })
    if (err instanceof AiNotConfigured) getState().set({ dialog: 'ai-settings' })
    return
  }

  const editor = getState()
  const historyStart = editor.past.length
  const docBefore = editor.doc
  const controller = new AbortController()
  add({ kind: 'user', id: uid(), text: prompt })
  appendMessage({
    role: 'user',
    content: [
      { type: 'text', text: `<show_state>\n${summarizeShow(editor.doc)}\n</show_state>` },
      { type: 'text', text: prompt },
    ],
  })
  useCopilot.setState({ running: true, controller })
  const tools = toolDefinitions(eagerStreaming())
  let retries = 0

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const replyId = uid()
      add({ kind: 'assistant', id: replyId, text: '', thinking: '', streaming: true })
      const stream = client.beta.messages.stream(
        {
          ...baseParams(),
          max_tokens: 32000,
          system: [{ type: 'text', text: COPILOT_SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools,
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: 'medium' },
          messages: useCopilot.getState().messages,
        },
        { signal: controller.signal },
      )
      stream.on('text', (delta) => patch(replyId, (it) => (it.kind === 'assistant' ? { ...it, text: it.text + delta } : it)))
      stream.on('thinking', (_delta, snapshot) => patch(replyId, (it) => (it.kind === 'assistant' ? { ...it, thinking: snapshot } : it)))

      let message
      try {
        message = await tracked(stream.finalMessage())
        retries = 0
      } catch (err) {
        // A tool input that can't be parsed at all, or a dropped connection, is
        // re-issued (that turn was never added to history). API errors and
        // user aborts are not.
        if (err instanceof Anthropic.APIError || controller.signal.aborted || retries++ >= 2) throw err
        remove(replyId)
        continue
      }
      recordUsage(message.usage, { model: message.model, label: 'Copilot' })
      patch(replyId, (it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it))
      const reply = useCopilot.getState().items.find((it) => it.id === replyId)
      if (reply?.kind === 'assistant' && !reply.text.trim()) remove(replyId)

      if (message.stop_reason === 'refusal') {
        add({ kind: 'notice', id: uid(), text: 'Claude declined this request. Try rephrasing it.', tone: 'error' })
        break
      }
      const content = echoContent(message.content)
      appendMessage({ role: 'assistant', content: asParams(content) })
      const calls = content.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use')
      if (!calls.length) break

      // Never run a tool whose input may have been cut off — but answer every
      // tool_use so the history stays valid.
      if (message.stop_reason === 'max_tokens') {
        appendMessage({ role: 'user', content: calls.map((c) => ({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Not run: the response was cut off before this call was complete.' })) })
        add({ kind: 'notice', id: uid(), text: 'The response was cut off. Try a smaller request.', tone: 'error' })
        break
      }

      const results: BetaToolResultBlockParam[] = []
      for (const call of calls) {
        const cardId = uid()
        add({ kind: 'tool', id: cardId, label: toolLabel(call.name, call.input), status: 'running' })
        if (controller.signal.aborted) {
          results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'Cancelled by the user.' })
          remove(cardId)
          continue
        }
        const out = await runTool(call.name, call.input, controller.signal)
        patch(cardId, () => ({ kind: 'tool', id: cardId, label: out.label, summary: out.summary, status: out.error ? 'error' : 'ok' }))
        results.push({ type: 'tool_result', tool_use_id: call.id, content: out.content, ...(out.error ? { is_error: true } : {}) })
      }
      appendMessage({ role: 'user', content: results })
      if (controller.signal.aborted) break
      if (step === MAX_STEPS - 1) add({ kind: 'notice', id: uid(), text: 'Stopped after many steps. Ask again to continue.', tone: 'info' })
    }
  } catch (err) {
    const aborted = controller.signal.aborted || err instanceof Anthropic.APIUserAbortError
    useCopilot.setState((s) => ({ items: s.items.filter((it) => !(it.kind === 'assistant' && it.streaming && !it.text)) }))
    add({ kind: 'notice', id: uid(), text: aborted ? 'Stopped.' : describeError(err), tone: aborted ? 'info' : 'error' })
  } finally {
    const changed = getState().doc !== docBefore
    if (changed) getState().squashHistory(historyStart, `AI: ${prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt}`)
    add({ kind: 'turn', id: uid(), changed, historyLength: getState().past.length })
    useCopilot.setState({ running: false, controller: null })
  }
}
