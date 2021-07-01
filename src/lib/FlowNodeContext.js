import FunctionsClient from './FunctionsClient'

async function byNodeId (flowId, id) {
  const result = await FunctionsClient.execute(process.env.GET_FLOW_NODE_CONTEXT_FUNCTION, { flowId, id })
  if (!result || !result.id) throw new Error('Cant validate the flow node')
  return result
}

export default {
  byNodeId
}
