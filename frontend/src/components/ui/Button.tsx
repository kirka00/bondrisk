import type { ButtonHTMLAttributes } from 'react'
import { button, cn, type ButtonVariants } from '../../lib/ui'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, Omit<ButtonVariants, 'icon'> { icon?: boolean }
export function Button({ variant, size, icon, className, type = 'button', ...rest }: Props) {
  return <button type={type} className={cn(button({ variant, size, icon: icon ? true : undefined }), className)} {...rest} />
}
