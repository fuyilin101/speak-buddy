type AudioRef = { current: HTMLAudioElement | null };

let activeRequest: AbortController | null = null;
let activeObjectUrl: string | null = null;
let generation = 0;
let activeText = '';
let activePromise: Promise<void> | null = null;

export function stopTts(audioRef: AudioRef) {
  generation += 1;
  activeRequest?.abort();
  activeRequest = null;
  activeText = '';
  activePromise = null;
  audioRef.current?.pause();
  audioRef.current?.removeAttribute('src');
  audioRef.current = null;
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
}

export async function speakTts(text: string, audioRef: AudioRef, onStatus: (message: string) => void) {
  const value = text.trim();
  if (!value) return;
  if (activePromise && activeText === value) return activePromise;
  stopTts(audioRef);
  activeText = value;
  const requestGeneration = generation;
  const controller = new AbortController();
  activeRequest = controller;
  const run = async () => {
   try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: value }),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('朗读请求过于频繁，请稍后再试');
      throw new Error(response.status === 413 ? '朗读文字太长，请分段播放' : '语音服务暂时不可用');
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('没有生成有效音频');
    if (requestGeneration !== generation) return;
    const url = URL.createObjectURL(blob);
    activeObjectUrl = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        URL.revokeObjectURL(url);
        if (activeObjectUrl === url) activeObjectUrl = null;
      }
    };
    await audio.play();
   } catch (error) {
    if (controller.signal.aborted) return;
    onStatus(error instanceof Error ? error.message : '语音服务暂时不可用');
   } finally {
    if (activeRequest === controller) activeRequest = null;
   }
  };
  activePromise = run();
  try { await activePromise; } finally {
    if (activePromise && activeText === value) { activePromise = null; activeText = ''; }
  }
}
