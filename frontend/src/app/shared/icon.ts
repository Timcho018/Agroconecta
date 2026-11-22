import { Component, input } from '@angular/core';

@Component({ selector: 'agro-icon', template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="paths[name()] || paths['leaf']" /></svg>`, styles: `:host{display:inline-flex;width:1.25em;height:1.25em;flex:none}svg{width:100%;height:100%}` })
export class Icon {
  name = input('leaf');
  paths: Record<string, string> = {
    exit: 'M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 16l4-4-4-4M18 12H8',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    eyeOff: 'M3 3l18 18M9 5.5A11 11 0 0 1 12 5c6.5 0 10 7 10 7a21 21 0 0 1-3 4M6 7.4A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5-1.2',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2c0-3 3-5 8-5s8 2 8 5v2',
    mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
    lock: 'M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
    leaf: 'M12 21V10M12 15C3 16 2 10 3 5c6 0 9 3 9 8M12 11c0-6 4-9 10-9 0 7-3 10-10 10',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16',
    calendar: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M3 9h18M8 2v4M16 2v4M7 13h2M13 13h2M7 17h2',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2',
    box: 'm3 7 9-5 9 5-9 5zM3 7v10l9 5 9-5V7M12 12v10M7 4l10 6',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    chart: 'M4 3v18h17M8 16v-5M13 16V7M18 16V4',
    arrow: 'M4 12h16M14 6l6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    rain: 'M5 15a4 4 0 0 1 0-8 6 6 0 0 1 11-2 5 5 0 0 1 3 10M8 17l-1 3M13 17l-1 3M18 17l-1 3',
    check: 'm5 12 4 4L19 6',
    workflow: 'M5 5h5v5H5zM14 14h5v5h-5zM10 7h4a3 3 0 0 1 3 3v4M5 17h6M8 14v6',
    layers: 'm12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5',
    warehouse: 'm3 10 9-7 9 7v11H3zM7 21v-8h10v8M7 16h10',
    truck: 'M2 6h12v12H2zM14 11h4l4 4v3h-8M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
    edit: 'M4 20h4l12-12-4-4L4 16zM14 6l4 4',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7v1',
    // Agricultural activity categories: outlines remain legible at calendar icon size.
    inspect: 'M3 3h6M3 3v6M21 3h-6M21 3v6M3 21h6M3 21v-6M21 21h-6M21 21v-6M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
    maintenance: 'M13 4a5 5 0 0 0 6 6l-9 9a3 3 0 0 1-4-4l9-9a5 5 0 0 0-2-2ZM13 4l3 3M6 15l3 3',
    seedling: 'M12 22V11M12 17c-7 0-9-4-9-9 6 0 9 3 9 9ZM12 13c0-6 4-9 9-9 0 6-3 9-9 9ZM7 22h10',
    harvest: 'M5 21V7M10 21V5M15 21V7M20 21V4M5 11C1 9 1 6 5 6M10 10C6 8 6 5 10 5M15 12c-4-2-4-5 0-5M20 9c-4-2-4-5 0-5M5 15l15-6M5 18l15-6',
    postharvest: 'M3 8l9-5 9 5v11l-9 4-9-4zM3 8l9 5 9-5M12 13v10M8 7l8 4M15.5 17l2 2 3-4',
    clipboard: 'M8 4h8M9 2h6v4H9zM8 4H5v18h14V4h-3M8 11h8M8 15h8M8 19h5',
  };
}
