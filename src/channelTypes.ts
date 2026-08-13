/** Shared channel types (avoid circular imports between channel + mongoChannel) */

export type Channel = {
  secret?: string
  longSlug: string
  shortSlug: string
  uploaderPeerID: string
}

export interface ChannelRepo {
  createChannel(uploaderPeerID: string, ttl?: number): Promise<Channel>
  fetchChannel(slug: string): Promise<Channel | null>
  renewChannel(slug: string, secret: string, ttl?: number): Promise<boolean>
  destroyChannel(slug: string): Promise<void>
}
