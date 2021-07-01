import { EventBridge } from 'aws-sdk'

const eventbridge = new EventBridge({ region: process.env.SERVERLESS_REGION })

export default class EventPublisher {
  static execute (payload = {}, options = {}) {
    return eventbridge.putEvents(payload).promise()
  }
}
