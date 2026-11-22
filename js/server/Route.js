/**
 * Created by Jerome on 24-02-17.
 */

class Route {
  constructor(path, departureTime, latency, action, orientation) {
    this.path = path;
    // need departureTime for update loop and delta for client
    // timestamp of the start of the movement ; only used for the server
    this.departureTime = departureTime;
    // latency of the player
    this.delta = Math.floor(latency);
    // numerical value of the action to perform at the end of the path (used server-side only)
    this.action = action;
    // orientation of the player at the end of the path
    this.orientation = orientation;
  }
}

module.exports.Route = Route;
