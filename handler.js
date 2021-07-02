// TODO: Apply Logging middleware for better logging
'use strict'
import * as request from 'request-promise'

import {
  EventPublisher,
  FlowContext,
  FlowNodeContext
} from '@owlflow/common'

function flattenObject (obj, res, prefix = '') {
  if (obj instanceof Array) {
    obj.forEach(function (item, i) {
      flattenObject(item, res, prefix + '__' + i)
    })
  } else if (obj instanceof Object) {
    for (const property in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, property)) {
        flattenObject(obj[property], res, prefix + '_' + property)
      }
    }
  } else if (['string', 'boolean', 'number'].includes(typeof obj)) {
    res[prefix] = obj
  } else if (obj === null) {
    res[prefix] = null
  } else {
    console.log('flattenObject else condition', typeof obj, obj, prefix)
  }

  return res
}

const asyncForEach = async (array, cb) => {
  for (let index = 0; index < array.length; index++) {
    await cb(array[index], index, array)
  }
}

const generateBitBucketToken = async (clientId, clientSecert) => {
  return await request({
    method: 'post',
    uri: 'https://bitbucket.org/site/oauth2/access_token',
    auth: {
      user: clientId,
      pass: clientSecert
    },
    form: {
      'grant_type': 'client_credentials'
    },
    json: true
  })
}

// The event handler endpoints
exports.gitlabV4Handler = async (event, context, callback) => {
  try {
    console.log(JSON.stringify(event))

    const nodeData = event.detail.nodeDetail

    if (nodeData.paused || nodeData.rootPaused) {
      throw new Error('OWLFlow root or node is inactive')
    }

    await asyncForEach((nodeData.actions || []), async (action) => {
      switch (action) {
        case 'declinePullRequest':
          try {
            let uri

            if (event.detail.flattenData[nodeData.meta[action].declineRef || '']) {
              uri = event.detail.flattenData[nodeData.meta[action].declineRef || ''] || ''
            } else {
              const prId = event.detail.flattenData[nodeData.meta[action].prId]
              uri = `https://api.bitbucket.org/2.0/repositories/${nodeData.meta.workspace}/${nodeData.meta.repoSlug}/pullrequests/${prId}/decline`
            }

            const { access_token } = await generateBitBucketToken(nodeData.meta.clientId, nodeData.meta.clientSecret)

            await request({
              method: 'POST',
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
    flattenObject(postData, res, nodeData.id)

    res[`${nodeData.id}_gitlab_event`] = event.headers['X-Gitlab-Event']

    await asyncForEach(nodeData.childrenIds, async (childrenId) => {
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
