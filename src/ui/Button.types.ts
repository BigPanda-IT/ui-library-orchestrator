import type { MouseEventHandler, ReactNode } from "react";

/** Общие свойства интерактивных компонентов библиотеки. */
export interface BaseInteractiveProps {
  /** Стабильный идентификатор для тестов и аналитики. */
  id?: string;
}

/** Семантический вариант кнопки. */
export type ButtonVariant = "primary" | "secondary" | "danger";

/** Публичный API компонента Button. */
export interface ButtonProps extends BaseInteractiveProps {
  /** Содержимое кнопки. */
  children: ReactNode;

  /** Визуальный и семантический вариант кнопки. */
  variant?: ButtonVariant;

  /** Показывает выполнение операции и блокирует повторное нажатие. */
  loading?: boolean;

  /** Блокирует взаимодействие с кнопкой. */
  disabled?: boolean;

  /** Вызывается при активации кнопки пользователем. */
  onClick?: MouseEventHandler<HTMLButtonElement>;

  /**
   * Старое название состояния загрузки.
   * @deprecated Используйте loading.
   */
  isPending?: boolean;
}
