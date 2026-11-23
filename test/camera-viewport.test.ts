import { expect, test } from 'bun:test';
import { cameraViewport } from '../src/cameraViewport.ts';

test('a phone in portrait keeps full-size tiles and shows more rows than columns', () => {
  expect(cameraViewport(390, 844, 32, 32)).toEqual({ x: 0, y: 0, width: 390, height: 844, zoom: 844 / 576 });
});

test('an ultrawide window zooms before its view can exceed one area of interest', () => {
  const { width, height, zoom } = cameraViewport(3440, 1440, 32, 32);
  expect(width / zoom).toBeLessThanOrEqual(1024);
  expect(height / zoom).toBeLessThanOrEqual(576);
});

test('an interior gains bands instead of revealing tiles beyond its legacy view', () => {
  const layout = cameraViewport(390, 844, 32, 32, { width: 980, height: 500 });
  expect(layout).toEqual({ x: 0, y: 56, width: 390, height: 732, zoom: 844 / 576 });
  expect(layout.height / layout.zoom).toBeLessThanOrEqual(500);
});
