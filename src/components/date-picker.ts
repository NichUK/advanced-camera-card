import {
  html,
  LitElement,
  unsafeCSS,
  type CSSResultGroup,
  type TemplateResult,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';

import { localize } from '../localize/localize';
import datePickerStyle from '../scss/date-picker.scss?inline';
import { stopEventFromActivatingCardWideActions } from '../utils/action';
import { fireAdvancedCameraCardEvent } from '../utils/fire-advanced-camera-card-event';
import {
  resolveZonedLocalTime,
  type ZonedTimeCandidate,
} from '../utils/zoned-local-time';

import './icon';

export interface DatePickerEvent {
  date: Date | null;
}

@customElement('advanced-camera-card-date-picker')
export class AdvancedCameraCardDatePicker extends LitElement {
  @property({ attribute: false })
  public icon?: string;

  @property({ attribute: 'time-zone', reflect: true })
  public timeZone?: string;

  @state()
  private _candidates: ZonedTimeCandidate[] = [];

  @state()
  private _error: string | null = null;

  private _selectedDate: Date | null = null;

  private _refInput: Ref<HTMLInputElement> = createRef();

  get value(): Date | null {
    if (this.timeZone) {
      return this._selectedDate;
    }
    return this._refInput.value?.value ? new Date(this._refInput.value.value) : null;
  }

  public reset(): void {
    this._candidates = [];
    this._error = null;
    this._selectedDate = null;
    if (this._refInput.value) {
      this._refInput.value.value = '';
    }
  }

  protected render(): TemplateResult {
    const changed = () => {
      const value = this._refInput.value?.value;

      if (this.timeZone && value) {
        const result = resolveZonedLocalTime(value, this.timeZone);
        this._candidates = result.candidates;
        this._error = result.error ? localize(`timeline.${result.error}`) : null;
        this._selectedDate =
          result.candidates.length === 1 ? result.candidates[0].date : null;
      } else {
        this._selectedDate = null;
        this._candidates = [];
        this._error = null;
      }

      fireAdvancedCameraCardEvent<DatePickerEvent>(this, 'date-picker:change', {
        date: this.timeZone ? this._selectedDate : value ? new Date(value) : null,
      });
    };

    return html`<input
        aria-label="${localize('timeline.select_date')}"
        title="${localize('timeline.select_date')}"
        ${ref(this._refInput)}
        type="datetime-local"
        @input=${() => changed()}
        @change=${() => changed()}
      />
      <advanced-camera-card-icon
        aria-label="${localize('timeline.select_date')}"
        title="${localize('timeline.select_date')}"
        .icon=${{ icon: this.icon ?? `mdi:calendar-search` }}
        @click=${(ev: Event) => {
          stopEventFromActivatingCardWideActions(ev);
          this._refInput.value?.showPicker();
        }}
      >
      </advanced-camera-card-icon>
      ${this.timeZone
        ? html`<span class="time-zone"
              >${localize('timeline.recording_time')}: ${this.timeZone}</span
            >
            <small
              >${localize('timeline.axis_time')}:
              ${Intl.DateTimeFormat().resolvedOptions().timeZone}</small
            >`
        : ''}
      ${this._candidates.length > 1
        ? html` <select
            aria-label=${localize('timeline.select_offset')}
            @change=${(event: Event) => {
              const target = event.target;
              const epoch =
                target instanceof HTMLSelectElement && target.value
                  ? Number(target.value)
                  : null;
              this._selectedDate =
                this._candidates.find((candidate) => candidate.date.getTime() === epoch)
                  ?.date ?? null;
              fireAdvancedCameraCardEvent<DatePickerEvent>(this, 'date-picker:change', {
                date: this._selectedDate,
              });
            }}
          >
            <option value="">${localize('timeline.select_offset')}</option>
            ${this._candidates.map(
              (candidate) =>
                html`<option value=${candidate.date.getTime()}>
                  ${candidate.offset}
                </option>`,
            )}
          </select>`
        : ''}
      ${this._error ? html`<span role="alert">${this._error}</span>` : ''}`;
  }

  static get styles(): CSSResultGroup {
    return unsafeCSS(datePickerStyle);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'advanced-camera-card-date-picker': AdvancedCameraCardDatePicker;
  }
}
