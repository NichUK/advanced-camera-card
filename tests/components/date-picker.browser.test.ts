import { afterEach, assert, expect, it } from 'vitest';

import type {
  AdvancedCameraCardDatePicker,
  DatePickerEvent,
} from '../../src/components/date-picker';

import '../../src/components/date-picker';

afterEach(() => document.body.replaceChildren());

const mount = async () => {
  const picker = document.createElement('advanced-camera-card-date-picker');
  picker.timeZone = 'Europe/Paris';
  document.body.append(picker);
  await picker.updateComplete;
  return picker;
};

const enter = async (picker: AdvancedCameraCardDatePicker, value: string) => {
  const input = picker.shadowRoot?.querySelector('input');
  assert(input);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await picker.updateComplete;
};

it('shows the recording timezone and selects the exact UTC instant', async () => {
  const picker = await mount();
  await enter(picker, '2026-10-02T14:35');
  expect(picker.shadowRoot?.textContent).toContain('Europe/Paris');
  expect(picker.value?.toISOString()).toBe('2026-10-02T12:35:00.000Z');
  expect(picker.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
  const input = picker.shadowRoot?.querySelector('input');
  assert(input);
  expect(getComputedStyle(input).visibility).toBe('visible');
  picker.reset();
  await picker.updateComplete;
  expect(picker.value).toBeNull();
  expect(input.value).toBe('');
});

it('explains a nonexistent local time without issuing a playback selection', async () => {
  const picker = await mount();
  let selected: Date | null = null;
  picker.addEventListener('advanced-camera-card:date-picker:change', (event) => {
    selected = (event as CustomEvent<DatePickerEvent>).detail.date;
  });
  await enter(picker, '2026-03-29T02:30');
  expect(picker.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain(
    'does not exist',
  );
  expect(picker.value).toBeNull();
  expect(selected).toBeNull();
});

it('requires an explicit UTC offset before selecting the repeated hour', async () => {
  const picker = await mount();
  await enter(picker, '2026-10-25T02:30');
  expect(picker.value).toBeNull();
  const select = picker.shadowRoot?.querySelector('select');
  assert(select);
  expect(Array.from(select.options).map((option) => option.text)).toEqual([
    'This time occurs twice. Choose its UTC offset.',
    'UTC+02:00',
    'UTC+01:00',
  ]);
  select.value = String(new Date('2026-10-25T01:30:00Z').getTime());
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(picker.value?.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  select.value = String(new Date('2026-10-25T00:30:00Z').getTime());
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(picker.value?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
});
