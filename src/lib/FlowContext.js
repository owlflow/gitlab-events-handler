import FunctionsClient from './FunctionsClient'

async function byWebhookId (organizationId, webhookId) {
  const result = await FunctionsClient.execute(process.env.GET_FLOW_CONTEXT_FUNCTION, { organizationId, webhookId })
  if (!result || !result.id) throw new Error('Cant validate the webhook')
  return result
}

export default {
  byWebhookId
}
