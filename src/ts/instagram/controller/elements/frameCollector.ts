import { VideoControllerElementBase } from './videoControllerElement';

const MAX_FRAMES = 100;
const MAX_CANVAS_SIDE = 32767;
const MAX_PIXELS = 100_000_000;

export function sampleTimes(
    start: number,
    intervalMs: number,
    durationSeconds: number,
    end: number
): number[] {
    if (
        ![start, intervalMs, durationSeconds, end].every(Number.isFinite) ||
        intervalMs < 1 ||
        durationSeconds <= 0 ||
        end <= start
    )
        return [];
    const count = Math.min(
        MAX_FRAMES,
        Math.ceil((durationSeconds * 1000) / intervalMs)
    );
    return Array.from(
        { length: count },
        (_, i) => start + (i * intervalMs) / 1000
    ).filter((time) => time < end && time < start + durationSeconds);
}

export class FrameCollectorButton extends VideoControllerElementBase<HTMLButtonElement> {
    private static active?: FrameCollectorButton;
    private panel?: HTMLDivElement;
    private frames: HTMLCanvasElement[] = [];
    private busy = false;
    private cancelled = false;
    private status?: HTMLElement;
    private fps?: HTMLInputElement;
    private interval?: HTMLInputElement;
    private duration?: HTMLInputElement;
    private sourceVideo?: HTMLVideoElement;
    private sourceUrl?: string;

    protected onCreate(parent: HTMLElement) {
        const button = document.createElement('button');
        button.className = 'ivc-control-element ivc-icon-button';
        button.textContent = '▦';
        button.title = 'Coletor de frames';
        button.setAttribute('aria-label', button.title);
        button.onclick = (event) => {
            event.stopPropagation();
            this.open();
        };
        parent.appendChild(button);
        this.element = button;
    }

    protected updateControl() {}

    public override remove() {
        this.close();
        super.remove();
    }

    private open() {
        if (this.panel) {
            this.close();
            return;
        }
        FrameCollectorButton.active?.close();
        FrameCollectorButton.active = this;
        const panel = document.createElement('div');
        panel.className = 'ivc-frame-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Coletor de frames');
        panel.innerHTML = `<div class="ivc-frame-heading"><strong>Coletor de frames</strong><button type="button" data-action="close" title="Fechar (Esc)">×</button></div>
            <p>Pause o vídeo e navegue pelos quadros. Os atalhos funcionam com este painel aberto.</p>
            <label>FPS para navegação <input data-input="fps" type="number" min="1" max="120" value="30"></label>
            <div class="ivc-frame-row"><button type="button" data-action="previous">← Anterior [,]</button><button type="button" data-action="next">Próximo [.] →</button></div>
            <div class="ivc-frame-row"><button type="button" data-action="capture">＋ Coletar [C]</button><button type="button" data-action="undo">Desfazer [Z]</button></div>
            <div class="ivc-frame-row"><label>Intervalo (ms) <input data-input="interval" type="number" min="1" value="500"></label><label>Duração (s) <input data-input="duration" type="number" min="0.01" step="0.1" value="5"></label></div>
            <div class="ivc-frame-row"><button type="button" data-action="auto">Coletar sequência [A]</button><button type="button" data-action="stop">Parar [S]</button></div>
            <p class="ivc-frame-status" aria-live="polite">Nenhum frame coletado.</p>
            <div class="ivc-frame-row"><button type="button" data-action="download">Baixar PNG [D]</button><button type="button" data-action="clear">Limpar [X]</button></div>`;
        panel.addEventListener('click', (event) => {
            event.stopPropagation();
            const action = (
                event.target as HTMLElement
            ).closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
            if (action) void this.act(action);
        });
        panel.addEventListener('pointerdown', (event) =>
            event.stopPropagation()
        );
        document.body.appendChild(panel);
        this.panel = panel;
        this.status = panel.querySelector('.ivc-frame-status') ?? undefined;
        this.fps = panel.querySelector('[data-input="fps"]') ?? undefined;
        this.interval =
            panel.querySelector('[data-input="interval"]') ?? undefined;
        this.duration =
            panel.querySelector('[data-input="duration"]') ?? undefined;
        document.addEventListener('keydown', this.onKey, true);
        this.updateStatus();
    }

    private close() {
        this.cancelled = true;
        document.removeEventListener('keydown', this.onKey, true);
        this.panel?.remove();
        this.panel = undefined;
        this.frames = [];
        this.sourceVideo?.removeAttribute('src');
        if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
        this.sourceVideo = undefined;
        this.sourceUrl = undefined;
        if (FrameCollectorButton.active === this)
            FrameCollectorButton.active = undefined;
    }

    private onKey = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.repeat)
            return;
        const target = event.target as HTMLElement;
        if (
            target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
        )
            return;
        const action: Record<string, string> = {
            ',': 'previous',
            '.': 'next',
            c: 'capture',
            z: 'undo',
            a: 'auto',
            s: 'stop',
            d: 'download',
            x: 'clear',
            Escape: 'close',
        };
        const selected = action[event.key.toLowerCase()] ?? action[event.key];
        if (!selected) return;
        event.preventDefault();
        event.stopPropagation();
        void this.act(selected);
    };

    private updateStatus(message?: string) {
        if (this.status)
            this.status.textContent =
                message ?? `${this.frames.length} frame(s) coletado(s).`;
    }

    private async seek(time: number, video = this.videoElement) {
        if (!video || !Number.isFinite(video.duration))
            throw new Error('Vídeo indisponível para navegação.');
        video.pause();
        const target = Math.max(
            0,
            Math.min(time, Math.max(0, video.duration - 0.001))
        );
        if (
            Math.abs(video.currentTime - target) < 0.0001 &&
            video.readyState >= 2
        )
            return;
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                cleanup();
                reject(new Error('O vídeo demorou para posicionar.'));
            }, 5000);
            const cleanup = () => {
                window.clearTimeout(timeout);
                video.removeEventListener('seeked', done);
                video.removeEventListener('error', fail);
            };
            const done = () => {
                cleanup();
                resolve();
            };
            const fail = () => {
                cleanup();
                reject(new Error('Não foi possível posicionar o vídeo.'));
            };
            video.addEventListener('seeked', done, { once: true });
            video.addEventListener('error', fail, { once: true });
            video.currentTime = target;
        });
    }

    private async capture() {
        const video = this.videoElement;
        if (
            !video ||
            !video.videoWidth ||
            !video.videoHeight ||
            video.readyState < 2
        )
            throw new Error('Aguarde o vídeo carregar.');
        if (this.frames.length >= MAX_FRAMES)
            throw new Error(`Limite de ${MAX_FRAMES} frames atingido.`);
        const width = video.videoWidth,
            height = video.videoHeight;
        if (
            this.frames.length &&
            (this.frames[0].width !== width || this.frames[0].height !== height)
        )
            throw new Error(
                'A resolução do vídeo mudou. Baixe ou limpe os frames antes de continuar.'
            );
        if (
            width * (this.frames.length + 1) > MAX_CANVAS_SIDE ||
            width * height * (this.frames.length + 1) > MAX_PIXELS
        )
            throw new Error(
                'Limite de tamanho da imagem atingido. Baixe os frames coletados.'
            );
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Não foi possível criar a imagem.');
        context.drawImage(video, 0, 0, width, height);
        try {
            context.getImageData(0, 0, 1, 1);
        } catch {
            // The player may be tainted by cross-origin media. The upstream
            // extension already uses hdSrc for its video download.
            const props = this.videoPlayer?.polarisFiber?.memoizedProps;
            const source =
                props && typeof props === 'object' && 'hdSrc' in props
                    ? props.hdSrc
                    : undefined;
            if (typeof source !== 'string' || !source)
                throw new Error(
                    'O navegador bloqueou a captura deste vídeo por restrição de origem.'
                );
            if (!this.sourceVideo) {
                const response = await fetch(source);
                if (!response.ok)
                    throw new Error(
                        'Não foi possível acessar o vídeo para coletar os frames.'
                    );
                const blob = await response.blob();
                if (this.cancelled || !this.panel) return;
                this.sourceUrl = URL.createObjectURL(blob);
                const copy = document.createElement('video');
                copy.preload = 'auto';
                copy.src = this.sourceUrl;
                await new Promise<void>((resolve, reject) => {
                    copy.addEventListener('loadeddata', () => resolve(), {
                        once: true,
                    });
                    copy.addEventListener(
                        'error',
                        () =>
                            reject(
                                new Error(
                                    'Não foi possível abrir o vídeo para coleta.'
                                )
                            ),
                        { once: true }
                    );
                });
                this.sourceVideo = copy;
            }
            await this.seek(video.currentTime, this.sourceVideo);
            if (this.cancelled || !this.panel) return;
            // Resetting dimensions clears the tainted bitmap.
            canvas.width = width;
            context.drawImage(this.sourceVideo, 0, 0, width, height);
            try {
                context.getImageData(0, 0, 1, 1);
            } catch {
                throw new Error(
                    'O navegador bloqueou a captura deste vídeo por restrição de origem.'
                );
            }
        }
        this.frames.push(canvas);
        this.updateStatus();
    }

    private download() {
        if (!this.frames.length)
            throw new Error('Colete pelo menos um frame antes de baixar.');
        const first = this.frames[0];
        const canvas = document.createElement('canvas');
        canvas.width = first.width * this.frames.length;
        canvas.height = first.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Não foi possível criar a imagem.');
        this.frames.forEach((frame, index) =>
            context.drawImage(frame, index * first.width, 0)
        );
        canvas.toBlob((blob) => {
            if (!blob) {
                this.updateStatus('Não foi possível gerar o PNG.');
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'instagram-frames.png';
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    }

    private async act(action: string) {
        if (action === 'close') {
            this.close();
            return;
        }
        if (action === 'stop') {
            this.cancelled = true;
            return;
        }
        if (this.busy) return;
        this.busy = true;
        try {
            const video = this.videoElement;
            if (!video) throw new Error('Vídeo indisponível.');
            if (action === 'previous' || action === 'next') {
                const fps = Number(this.fps?.value);
                if (!Number.isFinite(fps) || fps < 1 || fps > 120)
                    throw new Error('Informe FPS entre 1 e 120.');
                await this.seek(
                    video.currentTime + (action === 'next' ? 1 : -1) / fps
                );
            } else if (action === 'capture') {
                this.cancelled = false;
                video.pause();
                await this.capture();
            } else if (action === 'undo') {
                this.frames.pop();
                this.updateStatus();
            } else if (action === 'clear') {
                this.frames = [];
                this.updateStatus();
            } else if (action === 'download') this.download();
            else if (action === 'auto') {
                const interval = Number(this.interval?.value),
                    duration = Number(this.duration?.value);
                const times = sampleTimes(
                    video.currentTime,
                    interval,
                    duration,
                    video.duration
                );
                if (!times.length)
                    throw new Error(
                        'Informe intervalo e duração válidos e selecione um ponto antes do fim.'
                    );
                this.cancelled = false;
                for (const time of times) {
                    if (this.cancelled) break;
                    await this.seek(time);
                    if (this.cancelled) break;
                    await this.capture();
                }
                if (this.cancelled)
                    this.updateStatus(
                        `Coleta interrompida. ${this.frames.length} frame(s) coletado(s).`
                    );
                else if (times.length === MAX_FRAMES)
                    this.updateStatus(
                        `Limite de ${MAX_FRAMES} amostras por sequência atingido.`
                    );
            }
        } catch (error) {
            this.updateStatus(
                error instanceof Error
                    ? error.message
                    : 'Falha ao coletar frames.'
            );
        } finally {
            this.busy = false;
        }
    }
}
