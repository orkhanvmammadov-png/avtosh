# Accessibility contract
- All actions are real <button>s; card action rows keyboard-reachable in visual order.
- Status meaning never color-alone: pills/chips carry text; diff carries labels + "→" + struck-old/tinted-new.
- Dialogs/sheets: role=dialog, aria-labelledby (title) + aria-describedby (body); focus moves to dialog, Esc + backdrop close, focus returns to the invoking button.
- Read-only pending view: fields aria-readonly presentation; state bar is text.
- Moderator diff: sections are headed lists; added/removed prefixed with words (Əlavə edildi/Silindi), not just +/− glyphs; photo badges are text labels.
- Focus rings: 2px #147A4E offset 2 (system standard); no nested interactive controls; toasts aria-live polite.