/**
 * MongoDB channel store — drop-in Redis replacement for CheezyPizza.
 * Set MONGODB_URI (or CHANNEL_MONGODB_URI) to your ChunkChat / any Mongo URI.
 */
import 'server-only'
import mongoose, { Schema, type Model, type Connection } from 'mongoose'
import crypto from 'crypto'
import config from './config'
import { generateShortSlug, generateLongSlug } from './slugs'
import type { Channel, ChannelRepo } from './channelTypes'

const ChannelSchema = new Schema(
  {
    secret: { type: String },
    longSlug: { type: String, required: true, unique: true, index: true },
    shortSlug: { type: String, required: true, unique: true, index: true },
    uploaderPeerID: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
)

ChannelSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

type ChannelDoc = {
  secret?: string
  longSlug: string
  shortSlug: string
  uploaderPeerID: string
  expiresAt: Date
}

let conn: Connection | null = null
let ChannelModel: Model<ChannelDoc> | null = null

async function getModel(): Promise<Model<ChannelDoc>> {
  if (ChannelModel && conn?.readyState === 1) return ChannelModel

  const uri =
    process.env.CHANNEL_MONGODB_URI ||
    process.env.MONGODB_URI ||
    process.env.CHUNK_CHAT_URI ||
    ''

  if (!uri) {
    throw new Error('MONGODB_URI / CHANNEL_MONGODB_URI required for Mongo channel store')
  }

  if (!conn || conn.readyState !== 1) {
    conn = mongoose.createConnection(uri)
    await conn.asPromise()
    console.log('[ChannelRepo] Mongo connected')
  }

  ChannelModel =
    (conn.models.P2PChannel as Model<ChannelDoc>) ||
    conn.model<ChannelDoc>('P2PChannel', ChannelSchema)
  return ChannelModel
}

function toChannel(doc: ChannelDoc, scrubSecret = false): Channel {
  return {
    secret: scrubSecret ? undefined : doc.secret,
    longSlug: doc.longSlug,
    shortSlug: doc.shortSlug,
    uploaderPeerID: doc.uploaderPeerID,
  }
}

async function generateShortUntilUnique(
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  for (let i = 0; i < config.shortSlug.maxAttempts; i++) {
    const slug = await generateShortSlug()
    if (!(await exists(slug))) return slug
  }
  throw new Error('max attempts reached generating short slug')
}

async function generateLongUntilUnique(
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  for (let i = 0; i < config.longSlug.maxAttempts; i++) {
    const slug = await generateLongSlug()
    if (!(await exists(slug))) return slug
  }
  throw new Error('max attempts reached generating long slug')
}

export class MongoChannelRepo implements ChannelRepo {
  async createChannel(
    uploaderPeerID: string,
    ttl: number = config.channel.ttl,
  ): Promise<Channel> {
    const Model = await getModel()

    const shortSlug = await generateShortUntilUnique(async (s) =>
      Boolean(await Model.findOne({ shortSlug: s }).lean()),
    )
    const longSlug = await generateLongUntilUnique(async (s) =>
      Boolean(await Model.findOne({ longSlug: s }).lean()),
    )

    const channel: Channel = {
      secret: crypto.randomUUID(),
      longSlug,
      shortSlug,
      uploaderPeerID,
    }

    await Model.create({
      ...channel,
      expiresAt: new Date(Date.now() + ttl * 1000),
    })

    return channel
  }

  async fetchChannel(slug: string, scrubSecret = false): Promise<Channel | null> {
    const Model = await getModel()
    const doc =
      (await Model.findOne({ shortSlug: slug }).lean()) ||
      (await Model.findOne({ longSlug: slug }).lean())

    if (!doc) return null
    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) return null
    return toChannel(doc as ChannelDoc, scrubSecret)
  }

  async renewChannel(
    slug: string,
    secret: string,
    ttl: number = config.channel.ttl,
  ): Promise<boolean> {
    const channel = await this.fetchChannel(slug, false)
    if (!channel || channel.secret !== secret) return false

    const Model = await getModel()
    const expiresAt = new Date(Date.now() + ttl * 1000)
    await Model.updateOne(
      { shortSlug: channel.shortSlug },
      { $set: { expiresAt } },
    )
    return true
  }

  async destroyChannel(slug: string): Promise<void> {
    const Model = await getModel()
    await Model.deleteOne({
      $or: [{ shortSlug: slug }, { longSlug: slug }],
    })
  }
}

export function isMongoChannelConfigured(): boolean {
  return Boolean(
    process.env.CHANNEL_MONGODB_URI ||
      process.env.MONGODB_URI ||
      process.env.CHUNK_CHAT_URI,
  )
}
