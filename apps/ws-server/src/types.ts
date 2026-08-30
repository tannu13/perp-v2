export interface WebSocketData {
  id: string;
  marketId: string;
  subscribedFeeds: Set<string>;
  /**
   * Who this connection is, if it presented a valid ticket at the upgrade.
   *
   * `null` for an anonymous connection, which is the normal case: every public
   * feed on this server is public by construction and needs no identity. It is
   * set only from a verified ticket, never from anything the client asserts —
   * a `user_id` query parameter would be an account takeover with extra steps.
   */
  userId: string | null;
}
