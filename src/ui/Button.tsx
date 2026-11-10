import type { ReactElement } from "react";

import type { ButtonProps } from "./Button.types";

/** Кнопка для запуска пользовательского действия. */
export function Button({
  children,
  variant = "primary",
  loading = false,
  disabled = false,
  id,
  onClick,
}: ButtonProps): ReactElement {
  return (
    <button
      id={id}
      type="button"
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={onClick}
    >
      {loading ? "Загрузка…" : children}
    </button>
  );
}
