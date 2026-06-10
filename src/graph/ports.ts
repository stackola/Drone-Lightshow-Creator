// ============================================================================
// Port Definitions + Connection Validation
// ============================================================================
// Each node type declares its ports statically. Connection validation checks
// port existence, direction, edgeType compatibility, accepts list, maxConnections,
// and self-loop rejection.
// ============================================================================

import type { ShowNodeType, PortDef, ShowGraph, EdgeType } from './types'

// --- Static Port Definitions ---

export const NODE_PORT_DEFS: Record<ShowNodeType, PortDef[]> = {
  launch: [
    {
      id: 'flow-out',
      direction: 'output',
      label: 'Out',
      edgeType: 'flow',
      maxConnections: Infinity,
      accepts: ['formation', 'idle'],
    },
  ],
  formation: [
    {
      id: 'flow-in',
      direction: 'input',
      label: 'In',
      edgeType: 'flow',
      maxConnections: Infinity,
      accepts: ['launch', 'formation', 'idle'],
    },
    {
      id: 'flow-out',
      direction: 'output',
      label: 'Out',
      edgeType: 'flow',
      maxConnections: Infinity,
      accepts: ['formation', 'land', 'idle'],
    },
    {
      id: 'idle-attach',
      direction: 'input',
      label: 'Idle Attach',
      edgeType: 'attachment',
      maxConnections: Infinity,
      accepts: ['idle'],
    },
  ],
  idle: [
    {
      id: 'flow-in',
      direction: 'input',
      label: 'In',
      edgeType: 'flow',
      maxConnections: 1,
      accepts: ['formation', 'launch'],
    },
    {
      id: 'flow-out',
      direction: 'output',
      label: 'Out',
      edgeType: 'flow',
      maxConnections: Infinity,
      accepts: ['formation', 'land', 'idle'],
    },
    {
      id: 'attach-out',
      direction: 'output',
      label: 'Attach',
      edgeType: 'attachment',
      maxConnections: 1,
      accepts: ['formation'],
    },
  ],
  land: [
    {
      id: 'flow-in',
      direction: 'input',
      label: 'In',
      edgeType: 'flow',
      maxConnections: Infinity,
      accepts: ['formation', 'idle'],
    },
  ],
  group: [],
}

// --- Helpers ---

export function getPortDef(nodeType: ShowNodeType, portId: string): PortDef | undefined {
  const ports = NODE_PORT_DEFS[nodeType]
  return ports.find((p) => p.id === portId)
}

export function getPortsForNode(nodeType: ShowNodeType): PortDef[] {
  return NODE_PORT_DEFS[nodeType]
}

// --- Connection Validation ---

export interface ConnectionValidationResult {
  valid: boolean
  reason?: string
}

export function isValidConnection(
  graph: ShowGraph,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): ConnectionValidationResult {
  // Self-loop check
  if (sourceNodeId === targetNodeId) {
    return { valid: false, reason: 'Self-loops are not allowed' }
  }

  const sourceNode = graph.nodes.find((n) => n.id === sourceNodeId)
  const targetNode = graph.nodes.find((n) => n.id === targetNodeId)

  if (!sourceNode) {
    return { valid: false, reason: `Source node '${sourceNodeId}' not found` }
  }
  if (!targetNode) {
    return { valid: false, reason: `Target node '${targetNodeId}' not found` }
  }

  // Port existence
  const sourcePort = getPortDef(sourceNode.type, sourcePortId)
  const targetPort = getPortDef(targetNode.type, targetPortId)

  if (!sourcePort) {
    return { valid: false, reason: `Source port '${sourcePortId}' not found on ${sourceNode.type}` }
  }
  if (!targetPort) {
    return { valid: false, reason: `Target port '${targetPortId}' not found on ${targetNode.type}` }
  }

  // Direction check
  if (sourcePort.direction !== 'output') {
    return { valid: false, reason: `Source port '${sourcePortId}' is not an output` }
  }
  if (targetPort.direction !== 'input') {
    return { valid: false, reason: `Target port '${targetPortId}' is not an input` }
  }

  // Edge type compatibility
  if (sourcePort.edgeType !== targetPort.edgeType) {
    return {
      valid: false,
      reason: `Edge type mismatch: source is '${sourcePort.edgeType}', target is '${targetPort.edgeType}'`,
    }
  }

  // Accepts list
  if (!sourcePort.accepts.includes(targetNode.type)) {
    return { valid: false, reason: `Source port does not accept '${targetNode.type}'` }
  }
  if (!targetPort.accepts.includes(sourceNode.type)) {
    return { valid: false, reason: `Target port does not accept '${sourceNode.type}'` }
  }

  // Max connections
  const edgeType: EdgeType = sourcePort.edgeType
  const sourceEdgeCount = graph.edges.filter(
    (e) => e.source === sourceNodeId && e.sourcePort === sourcePortId && e.edgeType === edgeType,
  ).length
  const targetEdgeCount = graph.edges.filter(
    (e) => e.target === targetNodeId && e.targetPort === targetPortId && e.edgeType === edgeType,
  ).length

  if (sourceEdgeCount >= sourcePort.maxConnections) {
    return { valid: false, reason: `Source port '${sourcePortId}' max connections exceeded` }
  }
  if (targetEdgeCount >= targetPort.maxConnections) {
    return { valid: false, reason: `Target port '${targetPortId}' max connections exceeded` }
  }

  return { valid: true }
}
