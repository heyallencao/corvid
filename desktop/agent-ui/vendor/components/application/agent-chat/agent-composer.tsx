"use client";

import { useTemplateCopy } from "../../foundations/template-copy/template-copy";
import {
  RiArrowUpLine,
  RiGlobalLine,
  RiInfinityLine,
  RiSparklingLine,
  RiStopFill,
} from "@remixicon/react";
import type { FormEvent, ReactNode, KeyboardEvent } from "react";
import { ComposerLoader } from "../composer-loader/composer-loader";
import { cx } from "../../../utils/cx";

/* Adapted from BoardUI's free AgentComposer (MIT); Corvid owns consent and model controls. */
export interface AgentComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onPreview: () => void;
  canPreview: boolean;
  busy: boolean;
  starting?: boolean;
  startingLabel: string;
  canSubmit: boolean;
  previewLabel: string;
  promptLabel: string;
  promptPlaceholder: string;
  model?: string | null;
  provider?: string | null;
  messageCount: number;
  modelControls?: ReactNode;
  contextPreview?: ReactNode;
  consent?: ReactNode;
  className?: string;
}

export function AgentComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  onPreview,
  canPreview,
  busy,
  starting = false,
  startingLabel,
  canSubmit,
  previewLabel,
  promptLabel,
  promptPlaceholder,
  model,
  provider,
  messageCount,
  modelControls,
  contextPreview,
  consent,
  className,
}: AgentComposerProps) {
  const localize = useTemplateCopy();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return localize((
    <div className={cx("relative flex w-full flex-col gap-2.5", className)}>
      <ComposerLoader active={busy}>
        <form id="pi-boardui-composer-form" onSubmit={submit} className={cx(
          "flex h-[52px] w-full items-center gap-2.5 rounded-full p-2 ps-12 pe-12",
          busy ? "bg-transparent" : "bg-background-primary-default shadow-xs",
        )}>
          <label className="sr-only" htmlFor="pi-task-prompt">{promptLabel}</label>
          <textarea
            id="pi-task-prompt"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={promptPlaceholder}
            autoComplete="off"
            rows={1}
            className="h-5 min-h-5 min-w-0 flex-1 resize-none bg-transparent text-body-regular text-text-primary caret-text-primary outline-none placeholder:text-text-tertiary"
          />
          {model ? (
            <span className="hidden max-w-[12ch] shrink-0 items-center gap-1 truncate text-body-2-medium text-text-secondary sm:flex" title={`Answering with ${model}`}>
              <RiSparklingLine className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
              {shortModel(model)}
            </span>
          ) : null}
        </form>
      </ComposerLoader>

      {modelControls ? <div className="pi-boardui-model-row">{modelControls}</div> : null}
      <button
        type="button"
        aria-label={previewLabel}
        onClick={onPreview}
        disabled={!canPreview}
        className="absolute start-2 top-2 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full bg-ai-chat-composer-add-background text-foreground-icon-primary transition-colors duration-150 ease hover:bg-ai-chat-composer-add-hover-background disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:outline-none"
      >
        <RiGlobalLine className="size-5" aria-hidden />
      </button>
      {contextPreview}
      {consent}
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop generating"
          className="absolute end-2 top-2 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full bg-background-secondary-default text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:outline-none"
        >
          <RiStopFill className="size-5" aria-hidden />
        </button>
      ) : (
        <button
          type="submit"
          form="pi-boardui-composer-form"
          aria-label={starting ? startingLabel : "Send message"}
          aria-busy={starting ? "true" : undefined}
          disabled={!canSubmit || starting}
          className="pi-primary-action absolute end-2 top-2 z-10 flex size-9 min-h-0 min-w-0 cursor-pointer items-center justify-center rounded-full bg-button-primary p-0 text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:outline-none"
        >
          {starting ? <span className="sr-only">{startingLabel}</span> : null}
          <RiArrowUpLine className="size-5" aria-hidden />
        </button>
      )}
      <div className="flex h-[26px] w-full items-center justify-between">
        <StatusItem icon={RiInfinityLine} label={provider ?? "Not configured"} />
        <StatusItem icon={RiSparklingLine} label={messageCount === 0 ? "New chat" : `${messageCount} messages`} />
      </div>
    </div>
  ));
}

function StatusItem({ icon: Icon, label }: { icon: typeof RiInfinityLine; label: string }) {
  const localize = useTemplateCopy();
  return localize((
    <span className="flex min-w-0 items-center gap-1">
      <Icon className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
      <span className="truncate whitespace-nowrap text-body-2-medium text-text-secondary">{label}</span>
    </span>
  ));
}

function shortModel(model: string) {
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}
