/**
 * Minimal hand-curated CDP type surface. Mochi deliberately does NOT depend on
 * `chrome-devtools-protocol` — the generated full surface is multi-megabyte and
 * only a small slice is referenced. We grow this file as needed; every type
 * here corresponds to a method or event Mochi actually issues.
 *
 * Reference: https://chromedevtools.github.io/devtools-protocol/
 *
 * @see PLAN.md §8 — CDP engine design notes
 */

/** A monotonic CDP request id. */
export type CdpRequestId = number;

/** A logical CDP session (string id assigned by the browser). */
export type CdpSessionId = string;

/**
 * The on-the-wire shape of an outbound CDP command. Optional `sessionId` routes
 * to a sub-target; absent = root browser target.
 */
export interface CdpRequest {
  id: CdpRequestId;
  method: string;
  params?: unknown;
  sessionId?: CdpSessionId;
}

/** Inbound CDP message — either a response to an `id`, or an event. */
export interface CdpResponse {
  id?: CdpRequestId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
  sessionId?: CdpSessionId;
}

/**
 * A successful CDP response payload. The transport returns this when `error` is
 * absent; the caller is responsible for typing `result` to a method-specific
 * shape.
 */
export type CdpResultEnvelope<T = unknown> = { result: T };

/**
 * Subset of `Runtime.RemoteObject`. We only care about `objectId` (for
 * callFunctionOn round-trips) and `value`/`type` for primitive returns.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-RemoteObject
 */
export interface RemoteObject {
  type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
  subtype?: string;
  className?: string;
  /** Present when the value is JSON-serializable. */
  value?: unknown;
  /** Present when the object lives only by reference; required for callFunctionOn. */
  objectId?: string;
  description?: string;
}

/** Subset of `DOM.Node` we consult. */
export interface DomNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
}

/** Subset of `Page.Frame`. */
export interface PageFrame {
  id: string;
  parentId?: string;
  url: string;
  loaderId?: string;
}

/** `Page.frameAttached` event params. */
export interface FrameAttachedEvent {
  frameId: string;
  parentFrameId?: string;
}

/** `Page.frameNavigated` event params. */
export interface FrameNavigatedEvent {
  frame: PageFrame;
}

/** `Target.attachedToTarget` event params. */
export interface AttachedToTargetEvent {
  sessionId: CdpSessionId;
  targetInfo: {
    targetId: string;
    type: string;
    title: string;
    url: string;
    attached: boolean;
  };
  waitingForDebugger: boolean;
}

/**
 * Subset of `DOM.BoxModel` we consume in `Page.humanClick`. CDP returns the
 * border-box (and content-box, padding-box, etc.) as flat 8-number quads:
 * `[x0, y0, x1, y1, x2, y2, x3, y3]` walking the corners CCW.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/DOM/#type-BoxModel
 */
export interface BoxModel {
  content: readonly number[];
  border: readonly number[];
  padding: readonly number[];
  margin: readonly number[];
  width: number;
  height: number;
}

/**
 * Subset of `Input.dispatchMouseEvent` parameters we send. The full CDP type
 * has many optional fields; we only construct the ones the behavioral path
 * actually needs.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent
 */
export interface DispatchMouseEventParams {
  type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
  x: number;
  y: number;
  button?: "none" | "left" | "middle" | "right";
  buttons?: number;
  clickCount?: number;
  modifiers?: number;
  deltaX?: number;
  deltaY?: number;
}

/**
 * Subset of `Input.dispatchKeyEvent` parameters we send.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
 */
export interface DispatchKeyEventParams {
  type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
  key?: string;
  code?: string;
  text?: string;
  unmodifiedText?: string;
  modifiers?: number;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
}
