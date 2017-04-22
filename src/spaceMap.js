/* eslint-disable */
/**
 * Created by Jerome on 09-11-16.
 */

// A space map is a custom data struture, similar to a sparse 2D array. Entities
// are stored according to their coordinates;
// that is, two keys are needed to fetch entities, the x position and the y
// position. This allows fast look-up based on position.
class spaceMap {
  add(x, y, object) {
    if (!this[x]) {
      this[x] = {};
    }
    if (!this[x][y]) {
      this[x][y] = [];
    }
    this[x][y].push(object);
  }

  delete(x, y, object) {
    if (!this[x] || !this[x][y]) return;
    const idx = this[x][y].indexOf(object);
    if (idx >= 0) this[x][y].splice(idx, 1);
  }

  move(x1, y1, x2, y2, object) {
    this.delete(x1, y1, object);
    this.add(x2, y2, object);
  }

  get(x, y) {
    if (!this[x]) {
      return null;
    }
    if (!this[x][y]) {
      return null;
    }
    return this[x][y];
  }

  getFirst(x, y) {
    const objects = this.get(x, y);
    return (objects ? objects[0] : null);
  }

  getFirstFiltered(x, y, filters, notFilters) {
      // filters is an array of property names that need to be true
      // notFilters is an array of property names that need to be false
      // Returns the first entity at the given position, for which the values
      // in filters are true and the values in notFilters are false
      // e.g. return the first item on a given cell that is visible but is not a chest
    if (notFilters === undefined) {
      notFilters = [];
    }
    const objects = this.get(x, y);
    if (!objects) return null;
    for (let o = 0; o < objects.length; o += 1) {
      let ok = true;
      for (let f = 0; f < filters.length; f += 1) {
        if (!objects[o][filters[f]]) {
          ok = false;
          break;
        }
      }
      if (!ok) return null;
      for (let f = 0; f < notFilters.length; f += 1) {
        if (objects[o][notFilters[f]]) {
          ok = false;
          break;
        }
      }
      if (ok) return objects[o];
    }
    return null;
  }

  getAll(fnCall) {
    let l = [];
    // NB: If use forEach instead, "this" won't refer to the object!
    for (let i = 0; i < Object.keys(this).length; i += 1) {
      const x = Object.keys(this)[i];
      if (this[x]) {
        for (let j = 0; j < Object.keys(this[x]).length; j += 1) {
          const y = Object.keys(this[x])[j];
          if (this[x][y]) {
            if (fnCall) {
              for (let k = 0; k < this[x][y].length; k += 1) {
                l.push(this[x][y][k][fnCall]());
              }
            } else {
              l = l.concat(this[x][y]);
            }
          }
        }
      }
    }
    return l;
  }
}

export default spaceMap;
