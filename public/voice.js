const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
const maxSeconds = 45;

async function post(action, body, signal) {
  const response = await fetch('api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || '鱼渔没连上语音服务，稍后再试吧。');
  }
  return response;
}

function audioData(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('这段录音打不开，再试一次吧。'));
    reader.readAsDataURL(blob);
  });
}

function splitReading(value) {
  const parts = [];
  let remaining = value.trim();
  while (remaining.length > 320) {
    const opening = remaining.slice(0, 320);
    const boundary = Math.max(...['。', '！', '？', '，', '\n'].map((mark) => opening.lastIndexOf(mark)));
    const end = boundary >= 140 ? boundary + 1 : 320;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function createVoice({ report, recordingChanged, received }) {
  let recording;
  let reading;
  let context;

  function recordStatus(session, label, pressed) {
    session.button.textContent = label;
    session.button.setAttribute('aria-pressed', String(pressed));
  }

  function stopTracks(session) {
    session.stream?.getTracks().forEach((track) => track.stop());
    clearTimeout(session.timer);
  }

  function finishRecord(session) {
    if (recording !== session) return;
    stopTracks(session);
    recordStatus(session, session.label, false);
    recording = null;
    recordingChanged();
  }

  function cancelRecord() {
    if (!recording) return;
    const session = recording;
    session.controller.abort();
    if (session.recorder?.state === 'recording') session.recorder.stop();
    finishRecord(session);
  }

  async function completeRecord(session) {
    stopTracks(session);
    if (recording !== session) return;
    recordStatus(session, '正在转文字…', false);
    recordingChanged();
    report('鱼渔正在把录音变成文字…');
    try {
      const format = (session.recorder.mimeType || session.parts[0]?.type || 'audio/webm').split(';')[0];
      const blob = new Blob(session.parts, { type: format.replace(/^video\//, 'audio/') });
      if (blob.size < 300) throw new Error('这段录音太短了。点一下麦克风，再说慢一点。');
      const audio = await audioData(blob);
      const response = await post('dictation', { audio }, session.controller.signal);
      const result = await response.json();
      if (recording === session) received(session.target, result.text);
    } catch (error) {
      if (!session.controller.signal.aborted) report(error.message);
    } finally {
      finishRecord(session);
    }
  }

  async function record(button, target) {
    if (recording?.button === button) {
      if (recording.recorder?.state === 'recording') recording.recorder.stop();
      else if (!recording.recorder) {
        cancelRecord();
        report('');
      }
      return;
    }
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      report('当前浏览器打不开麦克风。可以试试手机的系统键盘语音输入。');
      return;
    }
    stopReading();
    const session = { button, target, label: button.textContent.trim(), controller: new AbortController(), parts: [] };
    recording = session;
    recordStatus(session, '取消打开麦克风', true);
    recordingChanged();
    report('正在打开麦克风。浏览器问你时，点「允许」。');
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
      if (recording !== session) return stopTracks(session);
      const mimeType = types.find((type) => MediaRecorder.isTypeSupported?.(type));
      session.recorder = new MediaRecorder(session.stream, mimeType ? { mimeType } : undefined);
      session.recorder.ondataavailable = (event) => { if (event.data.size) session.parts.push(event.data); };
      session.recorder.onstop = () => completeRecord(session);
      session.recorder.onerror = () => {
        finishRecord(session);
        report('录音中断了，再说一次吧。');
      };
      session.recorder.start();
      recordStatus(session, '■ 说完了', true);
      report('正在听你说。说完点「说完了」，最长 45 秒。');
      session.timer = setTimeout(() => {
        if (session.recorder.state === 'recording') session.recorder.stop();
      }, maxSeconds * 1000);
    } catch (error) {
      if (recording !== session) return;
      finishRecord(session);
      report(error.name === 'NotAllowedError'
        ? '麦克风没有打开。可以在浏览器允许使用麦克风，或用键盘输入。'
        : '暂时用不了麦克风，可以先用键盘输入。');
    }
  }

  function stopReading() {
    if (!reading) return;
    const session = reading;
    reading = null;
    session.controller.abort();
    session.sound?.stop();
    session.button.textContent = session.label;
    session.button.setAttribute('aria-pressed', 'false');
  }

  async function read(button, passage) {
    const same = reading?.button === button;
    stopReading();
    if (same || !passage.trim() || recording) return;
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return report('这个浏览器暂时播不了语音。');
    const session = { button, label: button.textContent.trim(), controller: new AbortController() };
    reading = session;
    button.textContent = '■ 停止朗读';
    button.setAttribute('aria-pressed', 'true');
    try {
      context ||= new Audio();
      await context.resume();
      for (const part of splitReading(passage)) {
        if (reading !== session) break;
        const response = await post('speak', { text: part }, session.controller.signal);
        const sound = context.createBufferSource();
        sound.buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (reading !== session) break;
        session.sound = sound;
        sound.connect(context.destination);
        await new Promise((resolve) => {
          sound.onended = resolve;
          sound.start();
        });
        session.sound = null;
      }
    } catch (error) {
      if (!session.controller.signal.aborted) report('朗读暂时没有播出来。可以再点一次。');
    } finally {
      if (reading === session) stopReading();
    }
  }

  return {
    record, read, stopReading, cancelRecord,
    get recordingButton() { return recording?.button; },
    get transcribing() { return recording?.recorder?.state === 'inactive'; },
  };
}
