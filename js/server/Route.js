/**
 * Created by Jerome on 24-02-17.
 */

class Route {
  constructor(entity, path, departureTime, latency, action, orientation) {
    this.id = entity.id;
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

  // Strips the Route object to retain only the properties relevant for the
  // clients, before sending it to them
  trim(type) {
    if (type === 'player') {
      return {
        orientation: this.orientation,
        // when broadcasting player paths, the whole path is not needed, only the endpoint
        end: this.path[this.path.length - 1],
        delta: this.delta, // the latency of the moving player
      };
    } else if (type === 'monster') {
      return {
        path: this.path, // for monsters, the whole path is needed
        delta: this.delta,
      };
    }
  }
}

module.exports.Route = Route;
