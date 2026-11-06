import { createRoot, type Root } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentComposer } from "../vendor/components/application/agent-chat/agent-composer";
import { AgentMessage } from "../vendor/components/application/agent-chat/agent-chat-message";
import { AgentThinking } from "../vendor/components/application/agent-thinking/agent-thinking";
import { TemplateCopyProvider } from "../vendor/components/foundations/template-copy/template-copy";

const composerRoots = new WeakMap<Element, Root>();
const transcriptRoots = new WeakMap<Element, Root>();

function corvidCopy(value: string) {
  const i18n = window.corvidI18n;
  if (!i18n) return value;
  const exact: Record<string, string> = {
    Message: i18n.t("describeBrowserTask"),
    "Ask me anything": i18n.t("askAboutPagePlaceholder"),
    "Stop generating": i18n.t("stopTask"),
    "Send message": i18n.t("send"),
    "Not configured": i18n.t("notConnected"),
    "New chat": i18n.t("agentNewChatStatus"),
    Copied: i18n.t("agentMessageCopied"),
    "Copy message": i18n.t("agentMessageCopy"),
    "Read aloud": i18n.t("agentMessageReadAloud"),
    "Stop reading aloud": i18n.t("agentMessageStopReading"),
    "just now": i18n.t("agentMessageJustNow"),
  };
  if (exact[value]) return exact[value];
  const messages = value.match(/^(\d+) messages$/);
  if (messages) return i18n.t("agentMessageCount", { count: i18n.formatNumber(Number(messages[1])) });
  const ago = value.match(/^(\d+) (minute|hour|day)s? ago$/);
  if (ago) {
    const key = { minute: "agentMessageMinutesAgo", hour: "agentMessageHoursAgo", day: "agentMessageDaysAgo" }[ago[2]];
    return i18n.t(key, { count: i18n.formatNumber(Number(ago[1])) });
  }
  const answering = value.match(/^Answering with (.+)$/);
  if (answering) return i18n.t("agentAnsweringWith", { model: answering[1] });
  return value;
}

function useBoardUiCopy() {
  const locale = window.corvidI18n?.locale;
  return useMemo(() => corvidCopy, [locale]);
}

function CorvidComposer(props: any) {
  const translate = useBoardUiCopy();
  const modelControl = useRef<HTMLDivElement>(null);
  const consentControl = useRef<HTMLInputElement>(null);
  const [modelState, setModelState] = useState({ model: "", provider: window.corvidI18n.t("notConnected") });
  const [draft, setDraft] = useState(props.value);
  const [starting, setStarting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [startError, setStartError] = useState("");
  const i18n = window.corvidI18n;

  useEffect(() => setDraft(props.value), [props.value]);
  useEffect(() => {
    if (props.contextPreview) consentControl.current?.focus();
  }, [props.contextPreview]);

  useEffect(() => {
    let cancelled = false;
    props.renderModelControls(modelControl.current);
    window.browserShell.invoke("piModels").then((catalog: any) => {
      if (cancelled) return;
      const selection = catalog.selection;
      const provider = catalog.providers.find((item: any) => item.id === selection.providerId);
      const model = provider?.models.find((item: any) => item.id === selection.modelId);
      setModelState({
        model: model?.name ? `${provider?.id}/${model.name}` : "",
        provider: provider?.name ? `${provider.name} · ${provider.authStatus || i18n.t("notConnected")}` : i18n.t("notConnected"),
      });
    }).catch(() => {
      if (!cancelled) setModelState({ model: "", provider: i18n.t("notConnected") });
    });
    return () => { cancelled = true; };
  }, [props.locale, props.renderModelControls, i18n]);

  const contextPreview = props.contextPreview ? (
    <div className="pi-context" role="region" aria-label={i18n.t("shareWithAgent")}>
      <strong>{i18n.t("shareWithAgent")}</strong>
      <span>{props.contextPreview.title}</span>
      <span>{props.contextPreview.url}</span>
      {props.contextPreview.snapshotTruncated ? <span>{i18n.t("truncatedPagePreview")}</span> : null}
      <pre>{props.contextPreview.snapshot}</pre>
    </div>
  ) : null;
  const consent = props.contextPreview ? (
    <label className="pi-consent">
      <input
        ref={consentControl}
        id={props.consentId || "pi-context-consent"}
        type="checkbox"
        checked={props.consent}
        onChange={(event) => props.onConsentChange(event.target.checked)}
      />
      {i18n.t(props.consentLabel || "pageShareConsent")}
    </label>
  ) : null;
  const onPreview = async () => {
    setStartError("");
    try {
      await props.onPreview();
    } catch (error) {
      setStartError(props.formatError(error));
    }
  };
  const onConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    setStartError("");
    try {
      await props.onConnect();
    } catch (error) {
      setStartError(i18n.t("cannotConnectCurrentPage", { message: props.formatError(error) }));
    } finally {
      setConnecting(false);
    }
  };
  const onSubmit = async () => {
    if (!props.canSubmit || starting) return;
    setStartError("");
    setStarting(true);
    try {
      await props.onSubmit(draft);
    } catch (error) {
      setStartError(i18n.t("messageNotSent", { message: props.formatError(error) }));
    } finally {
      setStarting(false);
    }
  };

  return (
    <TemplateCopyProvider translate={translate}>
      <div className="pi-boardui-composer">
        {props.pageLabel ? <div className="pi-page-binding" role="status">{props.pageLabel}</div> : null}
        {props.connectLabel ? (
          <button type="button" className="pi-create-room" onClick={onConnect}>{props.connectLabel}</button>
        ) : null}
        <AgentComposer
          value={draft}
          onValueChange={(value) => { setDraft(value); props.onValueChange(value); }}
          onSubmit={onSubmit}
          onStop={props.onStop}
          onPreview={onPreview}
          canPreview={Boolean(props.canPreview) && !connecting}
          previewLabel={i18n.t(props.previewLabel || "verifyPageContext")}
          promptLabel={i18n.t(props.promptLabel || "describeBrowserTask")}
          promptPlaceholder={i18n.t(props.promptPlaceholder || "askAboutPagePlaceholder")}
          busy={props.busy}
          starting={starting}
          startingLabel={i18n.t("startingTask")}
          canSubmit={props.canSubmit && !starting}
          model={modelState.model}
          provider={modelState.provider}
          messageCount={props.messageCount}
          modelControls={<div className="pi-model-controls" ref={modelControl} />}
          contextPreview={contextPreview}
          consent={consent}
        />
        {startError ? <p className="pi-boardui-error" role="alert">{startError}</p> : null}
      </div>
    </TemplateCopyProvider>
  );
}

function Transcript({ messages, thinking, locale }: any) {
  const i18n = window.corvidI18n;
  return (
    <TemplateCopyProvider translate={corvidCopy}>
      <div className="pi-boardui-transcript" aria-label={i18n.t("conversationHistory")}>
        {messages.map((message: any, index: number) => (
          <AgentMessage
            key={`${message.id || index}:${message.role}`}
            role={message.role}
            text={message.text || ""}
            streaming={Boolean(message.streaming)}
            at={message.at ? Date.parse(message.at) : undefined}
            userLabel={i18n.t("you")}
            assistantLabel="Corvid Agent"
          />
        ))}
        {thinking ? <AgentThinking variant="wave" label={i18n.t("taskRunning")} className="px-1" /> : null}
      </div>
    </TemplateCopyProvider>
  );
}

export function renderComposer(container: Element, props: any) {
  let root = composerRoots.get(container);
  if (!root) {
    root = createRoot(container);
    composerRoots.set(container, root);
  }
  root.render(<CorvidComposer {...props} />);
}

export function renderTranscript(container: Element, props: any) {
  let root = transcriptRoots.get(container);
  if (!root) {
    root = createRoot(container);
    transcriptRoots.set(container, root);
  }
  root.render(<Transcript {...props} />);
}

export function unmount(container: Element) {
  composerRoots.get(container)?.unmount();
  transcriptRoots.get(container)?.unmount();
  composerRoots.delete(container);
  transcriptRoots.delete(container);
}

window.corvidAgentUi = { renderComposer, renderTranscript, unmount };
