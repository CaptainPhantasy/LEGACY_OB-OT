// Touch movement stays relative to the view at the start of each gesture.
// Turning the camera must never change the path beneath a held thumb.
const DEAD_ZONE = .12;
const HALF_BUFFER = .12;

export class RoomTouchStick {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = false;
    this.heading = 0;
    this.x = 0;
    this.y = 0;
    this.forward = 0;
    this.right = 0;
    this.turnHeading = null;
    this.backHalf = false;
    this.turnDirection = 1;
    return this;
  }

  start(heading) {
    if (!Number.isFinite(heading)) throw new TypeError('The stick needs a finite heading.');
    this.reset();
    this.heading = heading;
    this.active = true;
    return this;
  }

  set(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError('The stick needs finite horizontal and vertical positions.');
    }
    if (!this.active) return this;

    // Scale before measuring so even a pointer far outside the control remains
    // a valid direction, then clamp to the circular rim rather than a square.
    const scale = Math.max(1, Math.abs(x), Math.abs(y));
    const scaledX = x / scale;
    const scaledY = y / scale;
    const divisor = Math.max(1, Math.hypot(scaledX, scaledY));
    this.x = scaledX / divisor;
    this.y = scaledY / divisor;
    const radius = Math.hypot(this.x, this.y);
    const factor = radius > DEAD_ZONE ? (radius - DEAD_ZONE) / ((1 - DEAD_ZONE) * radius) : 0;
    this.forward = factor ? -this.y * factor : 0;
    this.right = factor ? this.x * factor : 0;

    // A crossing emits one absolute camera target. It remains available until
    // consumed; holding the stick or jittering near the equator emits no turn.
    if (radius > DEAD_ZONE && !this.backHalf && this.y > HALF_BUFFER) {
      this.backHalf = true;
      if (Math.abs(this.x) > HALF_BUFFER) this.turnDirection = Math.sign(this.x);
      this.turnHeading = this.heading + this.turnDirection * Math.PI;
    } else if (radius > DEAD_ZONE && this.backHalf && this.y < -HALF_BUFFER) {
      this.backHalf = false;
      this.turnHeading = this.heading;
    }
    return this;
  }

  end() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.forward = 0;
    this.right = 0;
    this.turnHeading = null;
    this.backHalf = false;
    return this;
  }
}
