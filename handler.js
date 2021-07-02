// TODO: Apply Logging middleware for better logging
'use strict'
import * as request from 'request-promise'

import {
  EventPublisher,
  FlowContext,
  FlowNodeContext,
  Utils
} from '@owlflow/common'

// The event handler endpoints
exports.gitlabV4Handler = async (event, context, callback) => {
  try {
    console.log(JSON.stringify(event))

    const nodeData = event.detail.nodeDetail

    if (nodeData.paused || nodeData.rootPaused) {
      throw new Error('OWLFlow root or node is inactive')
    }

    await Utils.asyncForEach((nodeData.actions || []), async (action) => {
      switch (action) {
        case 'closeMergeRequest':
          try {
            const access_token = nodeData.meta.privateToken
            let uri = 'https://gitlab.com/api/v4'

            if (nodeData.meta.baseUrl) {
              uri = nodeData.meta.baseUrl
            }

            const projectId = event.detail.flattenData[nodeData.meta[action].projectId]
            const mergeRequestId = event.detail.flattenData[nodeData.meta[action].mergeRequestId]

            uri = `${uri}/projects/${projectId}/merge_requests/${mergeRequestId}`

            await request({
              method: 'PUT',
              uri,
              qs: {
                access_token,
              },
              body: nodeData.meta[action].body,
              json: true
            })
          } catch (e) {
            console.log(e.error)
          }

          break
      }
    })
  } catch (e) {
    console.log(e)
  } finally {
    callback(null, {
      statusCode: '200',
      body: JSON.stringify(event),
      headers: {
        'Content-Type': 'application/json'
      }
    })
  }
}

// The public HTTP Api endpoints
exports.gitlabWebhookHandler = async (event, context, callback) => {
  try {
    console.log(JSON.stringify(event))

    if (!event.headers['User-Agent'].startsWith('GitLab/')) {
      throw new Error('Invalid gitlab webhook user agent')
    }

    const { organizationId, webhookId } = event.pathParameters

    const flowData = await FlowContext.byWebhookId(organizationId, webhookId)

    if (flowData.paused) {
      throw new Error('OWLFlow flow is inactive')
    }

    const nodeData = await FlowNodeContext.byNodeId(flowData.id, flowData.parentNodeId) // nodes[flowData.parentNodeId]

    if (nodeData.paused || nodeData.rootPaused) {
      throw new Error('OWLFlow root or node is inactive')
    }

    if (nodeData.meta.headers['X-Gitlab-Token'] !== event.headers['X-Gitlab-Token']) {
      throw new Error('Invalid Gitlab webhook token')
    }

    if (!(nodeData.actions || []).includes(event.headers['X-Gitlab-Event'])) {
      throw new Error('Invalid gitlab webhook event')
    }

    const postData = JSON.parse(event.body)

    const res = {}

    Utils.flattenObject(postData, res, nodeData.id)

    res[`${nodeData.id}_gitlab_event`] = event.headers['X-Gitlab-Event']

    await Utils.asyncForEach(nodeData.childrenIds, async (childrenId) => {
      const childrenNode = await FlowNodeContext.byNodeId(flowData.id, childrenId) // nodes[childrenId]

      console.log(await EventPublisher.execute({
        Entries: [
          {
            Detail: JSON.stringify({
              event: 'owlflow.hooks',
              eventSource: 'hooks.owlflow.io',
              eventVersion: '1.0',
              consumerAPI: childrenNode.api,
              organizationId: flowData.organizationId,
              flowId: flowData.id,
              nodeDetail: childrenNode,
              flattenData: res
            }),
            DetailType: 'owlflow',
            EventBusName: process.env.OWLHUB_EVENT_BUS_NAME,
            Resources: [
              `orn:owlhub:owlflow:${flowData.organizationId}:flows/${flowData.id}`
            ],
            Source: 'owlhub.owlflow'
          }
        ]
      }))
    })
  } catch (e) {
    console.log(e)
  }

  callback(null, {
    statusCode: '200',
    body: JSON.stringify(event),
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
