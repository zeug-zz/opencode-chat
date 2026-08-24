import type { ChatSandboxSettings, ChatSandboxStatus } from "@opencode-chat/core";

export type ChatSandboxTransition<TResult> = (settings: ChatSandboxSettings) => TResult | PromiseLike<TResult>;

export type ChatSandboxControllerOptions<TResult> = {
  stop: () => void | PromiseLike<void>;
  start: ChatSandboxTransition<TResult>;
  publishStatus: (status: ChatSandboxStatus) => void;
  statusForStart?: (settings: ChatSandboxSettings, result: TResult) => ChatSandboxStatus;
  refresh?: (status: ChatSandboxStatus) => void | PromiseLike<void>;
  onReconnected?: (status: ChatSandboxStatus) => void | PromiseLike<void>;
  onError?: (error: unknown, status: ChatSandboxStatus) => void;
};

export class ChatSandboxController<TResult> {
  private pending: Promise<void> = Promise.resolve();
  private applying = false;
  private queuedUpdates = 0;
  private lastStatus: ChatSandboxStatus | undefined;
  private readonly stop: (() => void | PromiseLike<void>) | undefined;
  private readonly publishStatus: ((status: ChatSandboxStatus) => void) | undefined;
  private readonly statusForStart: ChatSandboxControllerOptions<TResult>["statusForStart"];
  private readonly onReconnected: ChatSandboxControllerOptions<TResult>["onReconnected"];
  private readonly onError: ChatSandboxControllerOptions<TResult>["onError"];
  private readonly start: ChatSandboxTransition<TResult>;

  constructor(transition: ChatSandboxTransition<TResult>);
  constructor(options: ChatSandboxControllerOptions<TResult>);
  constructor(transitionOrOptions: ChatSandboxTransition<TResult> | ChatSandboxControllerOptions<TResult>) {
    if (typeof transitionOrOptions === "function") {
      this.start = transitionOrOptions;
      return;
    }

    this.start = transitionOrOptions.start;
    this.stop = transitionOrOptions.stop;
    this.publishStatus = transitionOrOptions.publishStatus;
    this.statusForStart = transitionOrOptions.statusForStart;
    this.onReconnected = transitionOrOptions.onReconnected ?? transitionOrOptions.refresh;
    this.onError = transitionOrOptions.onError;
  }

  update(settings: ChatSandboxSettings): Promise<TResult> {
    this.queuedUpdates += 1;
    this.applying = true;
    const result =
      this.stop && this.publishStatus
        ? this.pending.then(async () => {
            this.publish(this.makeStatus(settings, true));
            try {
              await this.stop?.();
              const started = await this.start(settings);
              const startedStatus = this.makeStartedStatus(settings, started);
              await this.onReconnected?.(startedStatus);
              this.publish(startedStatus);
              return started;
            } catch (error) {
              const errorStatus = this.makeErrorStatus(settings, error);
              this.publish(errorStatus);
              try {
                this.onError?.(error, errorStatus);
              } catch (callbackError) {
                console.error("[OpenCode] Failed to report sandbox transition error:", callbackError);
              }
              throw error;
            }
          })
        : this.pending.then(() => this.start(settings));
    this.pending = result.then(
      () => {
        this.queuedUpdates -= 1;
        this.applying = this.queuedUpdates > 0;
      },
      () => {
        this.queuedUpdates -= 1;
        this.applying = this.queuedUpdates > 0;
      },
    );
    return result;
  }

  isApplying(): boolean {
    return this.applying;
  }

  assertRequestsAllowed(): void {
    if (this.applying) {
      throw new Error("Chat companion is applying sandbox settings");
    }
  }

  private publish(status: ChatSandboxStatus): void {
    this.lastStatus = status;
    this.publishStatus?.(status);
  }

  private makeStatus(settings: ChatSandboxSettings, applying: boolean): ChatSandboxStatus {
    return {
      ...(this.lastStatus ?? {
        enabled: settings.mode === "on",
        inherited: settings.mode === "inherit",
        managed: false,
        supported: true,
      }),
      ...settings,
      applying,
      error: undefined,
    };
  }

  private makeStartedStatus(settings: ChatSandboxSettings, result: TResult): ChatSandboxStatus {
    if (this.statusForStart) {
      return this.statusForStart(settings, result);
    }
    if (this.isStatus(result)) {
      return result;
    }
    return this.makeStatus(settings, false);
  }

  private makeErrorStatus(settings: ChatSandboxSettings, error: unknown): ChatSandboxStatus {
    return {
      ...this.makeStatus(settings, false),
      enabled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  private isStatus(value: TResult): value is TResult & ChatSandboxStatus {
    return typeof value === "object" && value !== null && "applying" in value && "enabled" in value;
  }
}
