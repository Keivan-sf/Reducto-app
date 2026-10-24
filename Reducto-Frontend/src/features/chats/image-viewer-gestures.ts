export type ImagePoint = { x: number; y: number };
type Transform = { scale: number; x: number; y: number; dismiss: number };
type Session = {
  points: ImagePoint[];
  transform: Transform;
  canDismiss: boolean;
  canTap: boolean;
  startedAt: number;
  dx: number;
  dy: number;
};
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value)) || 0;
const distance = (a: ImagePoint, b: ImagePoint) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (points: ImagePoint[]) => ({
  x: (points[0].x + points[1].x) / 2,
  y: (points[0].y + points[1].y) / 2,
});

// Both native responders and browser pointers use the same gesture arbitration.
export class ImageViewerGestures {
  transform: Transform = { scale: 1, x: 0, y: 0, dismiss: 0 };
  private viewport = { width: 0, height: 0 };
  private image = { width: 0, height: 0 };
  private session: Session | null = null;
  private lastTap: { point: ImagePoint; time: number } | null = null;

  constructor(private readonly onChange: (transform: Transform) => void) {}

  reset() {
    this.session = null;
    this.lastTap = null;
    this.transform = { scale: 1, x: 0, y: 0, dismiss: 0 };
    this.publish();
  }

  layout(width: number, height: number) {
    this.viewport = { width, height };
    this.reset();
  }

  imageSize(width: number, height: number) {
    this.image = { width, height };
    this.publish();
  }

  private publish() {
    const { width, height } = this.viewport;
    const fit =
      this.image.width && this.image.height
        ? Math.min(width / this.image.width, height / this.image.height)
        : 1;
    const imageWidth = this.image.width ? this.image.width * fit : width;
    const imageHeight = this.image.height ? this.image.height * fit : height;
    this.transform.x = clamp(
      this.transform.x,
      Math.max(0, (imageWidth * this.transform.scale - width) / 2),
    );
    this.transform.y = clamp(
      this.transform.y,
      Math.max(0, (imageHeight * this.transform.scale - height) / 2),
    );
    this.onChange({ ...this.transform });
  }

  update(points: ImagePoint[], now = Date.now()) {
    if (!points.length) return;
    let session = this.session;
    if (!session || session.points.length !== points.length) {
      const multitouch = points.length > 1;
      // Once a gesture pans or pinches, lifting a finger never turns it into a close.
      const canDismiss = !multitouch && this.transform.scale === 1 && !session;
      if (session || multitouch) this.lastTap = null;
      this.transform.dismiss = 0;
      session = this.session = {
        points: points.map((point) => ({ ...point })),
        transform: { ...this.transform },
        canDismiss,
        canTap: !session && !multitouch,
        startedAt: now,
        dx: 0,
        dy: 0,
      };
      this.publish();
      return;
    }
    if (points.length > 1) {
      const startDistance = distance(session.points[0], session.points[1]);
      if (startDistance < 1) return;
      const scale = Math.max(
        1,
        Math.min(4, (session.transform.scale * distance(points[0], points[1])) / startDistance),
      );
      const start = midpoint(session.points);
      const current = midpoint(points);
      const ratio = scale / session.transform.scale;
      this.transform = {
        scale,
        x:
          current.x -
          this.viewport.width / 2 -
          (start.x - this.viewport.width / 2 - session.transform.x) * ratio,
        y:
          current.y -
          this.viewport.height / 2 -
          (start.y - this.viewport.height / 2 - session.transform.y) * ratio,
        dismiss: 0,
      };
    } else {
      session.dx = points[0].x - session.points[0].x;
      session.dy = points[0].y - session.points[0].y;
      if (Math.hypot(session.dx, session.dy) > 10) {
        session.canTap = false;
        this.lastTap = null;
      }
      if (session.canDismiss) {
        this.transform.dismiss = Math.abs(session.dy) > Math.abs(session.dx) ? session.dy : 0;
      } else {
        this.transform.x = session.transform.x + session.dx;
        this.transform.y = session.transform.y + session.dy;
      }
    }
    this.publish();
  }

  finish(cancelled = false, now = Date.now()) {
    const session = this.session;
    this.session = null;
    if (!session) return false;
    const close =
      !cancelled &&
      session.canDismiss &&
      Math.abs(session.dy) >= 90 &&
      Math.abs(session.dy) > Math.abs(session.dx);
    if (!cancelled && session.canTap && now - session.startedAt < 300) {
      const point = session.points[0];
      if (
        this.lastTap &&
        now - this.lastTap.time < 300 &&
        distance(point, this.lastTap.point) < 30
      ) {
        const scale = this.transform.scale > 1 ? 1 : 2.5;
        const ratio = scale / this.transform.scale;
        this.transform = {
          scale,
          x: (point.x - this.viewport.width / 2) * (1 - ratio) + this.transform.x * ratio,
          y: (point.y - this.viewport.height / 2) * (1 - ratio) + this.transform.y * ratio,
          dismiss: 0,
        };
        this.lastTap = null;
      } else this.lastTap = { point, time: now };
    } else this.lastTap = null;
    this.transform.dismiss = 0;
    this.publish();
    return close;
  }
}
