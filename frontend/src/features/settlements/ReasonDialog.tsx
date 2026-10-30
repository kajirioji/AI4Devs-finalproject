import { useId, useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { strings } from './strings'

const s = strings.summary.actions
/** undoReason is NVARCHAR(500); the reason of unpay is audited with the same limit (design D8). */
const MAX_REASON = 500

/**
 * An action with a required reason and its consequences (spec "motivo y confirmación"): the reason starts empty each
 * time and travels without the spaces of its ends. Escape or Cancel close the dialog without calling the API; the focus
 * goes back to the action. `onConfirm` says whether to close it: a retryable failure keeps it, with what was written.
 */
export function ReasonDialog({
  label,
  title,
  body,
  pending,
  error,
  onOpen,
  onConfirm,
}: {
  label: string
  title: string
  body: string
  pending: boolean
  /** Why the last confirmation failed, while the dialog stays open. */
  error: string | null
  onOpen: () => void
  onConfirm: (reason: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const hintId = useId()
  const fieldId = useId()
  const reason = text.trim()
  const tooLong = reason.length > MAX_REASON
  const hint = reason === '' ? s.writeReason : tooLong ? s.tooLong : null

  const onOpenChange = (next: boolean) => {
    if (next) {
      setText('')
      onOpen()
    }
    setOpen(next)
  }

  const confirm = async () => {
    if (await onConfirm(reason)) setOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending}>
          {pending ? s.working : label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor={fieldId}>{s.reason}</Label>
          <Textarea
            id={fieldId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-invalid={tooLong}
            aria-describedby={hint ? hintId : undefined}
            autoFocus
          />
          {hint && (
            <p id={hintId} className={tooLong ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {hint}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{s.cancel}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={hint !== null || pending}
            aria-describedby={hint ? hintId : undefined}
          >
            {pending ? s.working : s.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
