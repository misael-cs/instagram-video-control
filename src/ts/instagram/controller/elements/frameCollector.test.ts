import { FrameCollectorButton, sampleTimes } from './frameCollector';
import { describe, expect, test, jest } from '@jest/globals';
import { CustomVideoController } from '../customVideoController';

describe('frame sampling schedule', () => {
    test('samples from the current position at the requested interval', () => {
        expect(sampleTimes(2, 500, 2, 20)).toEqual([2, 2.5, 3, 3.5]);
    });

    test('stops at the end of the video', () => {
        expect(sampleTimes(9, 400, 5, 10)).toEqual([9, 9.4, 9.8]);
    });

    test('rejects invalid inputs and caps large sequences', () => {
        expect(sampleTimes(0, 0, 5, 10)).toEqual([]);
        expect(sampleTimes(0, 100, NaN, 10)).toEqual([]);
        expect(sampleTimes(0, 1, 20, 100)).toHaveLength(100);
    });
});

test('collects and removes a frame through the panel', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
        videoWidth: { value: 20 },
        videoHeight: { value: 10 },
        readyState: { value: 2 },
        duration: { value: 10 },
    });
    video.pause = jest.fn();
    const context = { drawImage: jest.fn(), getImageData: jest.fn() };
    const canvas = jest
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const controller = {
        videoElement: video,
        videoPlayer: {},
    } as unknown as CustomVideoController;
    const collector = new FrameCollectorButton(controller);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    collector.create(parent);
    parent.querySelector('button')?.click();
    document
        .querySelector<HTMLButtonElement>('[data-action="capture"]')
        ?.click();
    await Promise.resolve();
    expect(document.querySelector('.ivc-frame-status')?.textContent).toBe(
        '1 frame(s) coletado(s).'
    );
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 20, 10);
    document.querySelector<HTMLButtonElement>('[data-action="undo"]')?.click();
    expect(document.querySelector('.ivc-frame-status')?.textContent).toBe(
        '0 frame(s) coletado(s).'
    );
    collector.remove();
    parent.remove();
    canvas.mockRestore();
});
