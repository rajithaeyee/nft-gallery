type TransactionNotification = {
  status: Ref<TransactionStatus>
  isError: Ref<boolean>
  sessionId: Ref<string | undefined >
  init: () => () => void
  updateSession: ReturnType<typeof useLoadingNotfication>['updateSession']
  initOn?: TransactionStatus[]
  autoTeleport?: Ref<boolean>
}

export default function ({ status, isError, sessionId, init, updateSession, initOn = [TransactionStatus.Broadcast], autoTeleport = ref(false) }: TransactionNotification) {
  const closeModal = ref(() => {})

  watchEffect(() => {
    if (initOn.includes(status.value) && !autoTeleport.value) {
      closeModal.value = init()
    }
  })

  useTransactionTracker({
    transaction: {
      isError,
      status,
    },
    onSuccess: () => {
      if (sessionId.value && !autoTeleport.value) {
        updateSession(sessionId.value, {
          state: 'succeeded',
        })
      }
    },
    onError: () => {
      if (sessionId.value && !autoTeleport.value) {
        closeModal.value?.()
      }
    },
  })
}