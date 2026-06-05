export interface WebSocketData {
  id: string;
  marketId: string;
  subscribedFeeds: Set<string>;
}
