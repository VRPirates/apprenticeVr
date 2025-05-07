import React, { useState, useEffect, useCallback } from 'react'
import { GameInfo } from '../types/adb'
import {
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogActions,
  Button,
  DialogContent,
  tokens,
  shorthands,
  makeStyles,
  Text,
  Image,
  Badge,
  Divider,
  Spinner
} from '@fluentui/react-components'
import {
  ArrowClockwiseRegular,
  DismissRegular,
  DocumentDataRegular,
  CalendarClockRegular,
  ArrowDownloadRegular as DownloadIcon,
  TagRegular,
  DeleteRegular,
  ArrowSyncRegular,
  ArrowUpRegular,
  InfoRegular,
  CheckmarkCircleRegular
} from '@fluentui/react-icons'
import placeholderImage from '../assets/images/game-placeholder.png'

const useStyles = makeStyles({
  dialogContentLayout: {
    display: 'grid',
    gridTemplateColumns: '150px 1fr',
    gap: tokens.spacingHorizontalL,
    marginTop: tokens.spacingVerticalL,
    marginBottom: tokens.spacingVerticalXL,
    alignItems: 'start'
  },
  detailsColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL
  },
  infoSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS
  },
  badgesAndInfoContainer: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    alignItems: 'center',
    marginTop: tokens.spacingVerticalS,
    flexWrap: 'wrap'
  },
  badgeGroup: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center'
  },
  inlineInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS
  },
  detailList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM
  },
  noteSection: {
    marginTop: tokens.spacingVerticalL,
    marginBottom: tokens.spacingVerticalL
  },
  noteTitle: {
    marginBottom: tokens.spacingVerticalS,
    display: 'block'
  },
  noteContent: {
    whiteSpace: 'pre-wrap',
    maxHeight: '150px',
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium
  },
  actionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS
  },
  deleteConfirmText: {
    ...shorthands.padding(tokens.spacingVerticalM, 0)
  },
  installingIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS
  }
})

interface GameDetailsDialogProps {
  game: GameInfo | null
  open: boolean
  onClose: () => void
  downloadStatusMap: Map<string, { status: string; progress: number }>
  onInstall: (game: GameInfo) => void
  onReinstall: (game: GameInfo) => void
  onUpdate: (game: GameInfo) => Promise<void>
  onRetry: (game: GameInfo) => void
  onCancelDownload: (game: GameInfo) => void
  onConfirmDelete: (game: GameInfo) => void
  onDeleteDownloaded: (game: GameInfo) => void
  onInstallFromCompleted: (game: GameInfo) => void
  getNote: (releaseName: string) => Promise<string | null>
  isConnected: boolean
  isBusy: boolean
}

const GameDetailsDialog: React.FC<GameDetailsDialogProps> = ({
  game,
  open,
  onClose,
  downloadStatusMap,
  onInstall,
  onReinstall,
  onUpdate,
  onRetry,
  onCancelDownload,
  onConfirmDelete,
  onDeleteDownloaded,
  onInstallFromCompleted,
  getNote,
  isConnected,
  isBusy
}) => {
  const styles = useStyles()
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<boolean>(false)
  const [currentGameNote, setCurrentGameNote] = useState<string | null>(null)
  const [loadingNote, setLoadingNote] = useState<boolean>(false)

  // Fetch note when dialog opens or game changes
  useEffect(() => {
    let isMounted = true

    if (open && game && game.releaseName) {
      const fetchNote = async (): Promise<void> => {
        setLoadingNote(true)
        setCurrentGameNote(null)
        try {
          const note = await getNote(game.releaseName)
          if (isMounted) {
            setCurrentGameNote(note)
          }
        } catch (err) {
          console.error(`Error fetching note for ${game.releaseName}:`, err)
          if (isMounted) {
            setCurrentGameNote('Error loading note.')
          }
        } finally {
          if (isMounted) {
            setLoadingNote(false)
          }
        }
      }
      fetchNote()
    }

    return () => {
      isMounted = false
    }
  }, [open, game, getNote])

  // Internal handler to request delete confirmation
  const handleDeleteRequest = (): void => {
    setIsDeleteConfirmOpen(true)
  }

  // Internal handler for confirming delete (calls prop)
  const handleConfirmDeleteInternal = useCallback(() => {
    if (game) {
      // Don't close main dialog here, parent should handle it after action
      onConfirmDelete(game)
      setIsDeleteConfirmOpen(false) // Only close the confirmation dialog
    }
  }, [game, onConfirmDelete])

  // Helper function to render action buttons based on game state
  const renderActionButtons = (currentGame: GameInfo): React.ReactNode => {
    const status = downloadStatusMap.get(currentGame.releaseName || '')?.status
    const canCancel = status === 'Downloading' || status === 'Extracting' || status === 'Queued'
    const isDownloaded = status === 'Completed'
    const isInstalled = currentGame.isInstalled
    const hasUpdate = currentGame.hasUpdate
    const isInstallError = status === 'InstallError'
    const isErrorOrCancelled = status === 'Error' || status === 'Cancelled'
    const isInstalling = status === 'Installing'

    if (isInstalling) {
      return (
        <div className={styles.installingIndicator}>
          <Spinner size="small" />
          <Text>Installing...</Text>
        </div>
      )
    }

    if (canCancel) {
      return (
        <Button
          appearance="danger"
          icon={<DismissRegular />}
          onClick={() => onCancelDownload(currentGame)}
          disabled={isBusy}
        >
          Cancel Download
        </Button>
      )
    }

    if (isInstallError || isErrorOrCancelled) {
      return (
        <>
          <Button
            appearance="primary"
            icon={<ArrowClockwiseRegular />}
            onClick={() => onRetry(currentGame)}
            disabled={isBusy}
          >
            Retry
          </Button>
          <Button
            appearance="danger"
            icon={<DeleteRegular />}
            onClick={() => onDeleteDownloaded(currentGame)}
            disabled={isBusy}
          >
            Delete Downloaded Files
          </Button>
        </>
      )
    }

    if (isInstalled) {
      if (hasUpdate) {
        return (
          <>
            <Button
              appearance="primary"
              icon={<ArrowUpRegular />}
              onClick={() => onUpdate(currentGame)}
              disabled={!isConnected || isBusy}
            >
              Update
            </Button>
            <Button
              appearance="danger"
              icon={<DeleteRegular />}
              onClick={handleDeleteRequest}
              disabled={!isConnected || isBusy}
            >
              Delete
            </Button>
          </>
        )
      } else {
        return (
          <>
            <Button
              appearance="secondary"
              icon={<ArrowSyncRegular />}
              onClick={() => onReinstall(currentGame)}
              disabled={!isConnected || isBusy}
            >
              Reinstall
            </Button>
            <Button
              appearance="danger"
              icon={<DeleteRegular />}
              onClick={handleDeleteRequest}
              disabled={!isConnected || isBusy}
            >
              Delete
            </Button>
          </>
        )
      }
    }

    if (isDownloaded) {
      return (
        <>
          <Button
            appearance="primary"
            icon={<CheckmarkCircleRegular />}
            onClick={() => onInstallFromCompleted(currentGame)}
            disabled={!isConnected || isBusy}
          >
            Install
          </Button>
          <Button
            appearance="danger"
            icon={<DeleteRegular />}
            onClick={() => onDeleteDownloaded(currentGame)}
            disabled={isBusy}
          >
            Delete Downloaded Files
          </Button>
        </>
      )
    }

    return (
      <Button
        appearance="primary"
        icon={<DownloadIcon />}
        onClick={() => onInstall(currentGame)}
        disabled={isBusy}
      >
        Install
      </Button>
    )
  }

  const handleClose = (): void => {
    setIsDeleteConfirmOpen(false)
    onClose()
  }

  if (!game) return null

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(_e, data) => !data.open && handleClose()}
        modalType="modal"
      >
        <DialogSurface mountNode={document.getElementById('portal')}>
          <DialogBody>
            <DialogTitle>{game?.name}</DialogTitle>
            <DialogContent>
              <div className={styles.dialogContentLayout}>
                <div>
                  <Image
                    src={game.thumbnailPath ? `file://${game.thumbnailPath}` : placeholderImage}
                    alt={`${game.name} thumbnail`}
                    shape="rounded"
                    width={150}
                    height={150}
                    fit="cover"
                  />
                </div>
                <div className={styles.detailsColumn}>
                  <div className={styles.infoSection}>
                    <Text size={600} weight="semibold">
                      {game.name}
                    </Text>
                    <Text
                      size={300}
                      weight="regular"
                      style={{ color: tokens.colorNeutralForeground2 }}
                    >
                      {game.packageName}
                    </Text>
                    <div className={styles.badgesAndInfoContainer}>
                      <div className={styles.badgeGroup}>
                        <Badge
                          shape="rounded"
                          color={(() => {
                            const status = downloadStatusMap.get(game.releaseName || '')?.status
                            if (game.isInstalled) return 'success'
                            if (status === 'Completed') return 'brand'
                            if (status === 'InstallError') return 'danger'
                            if (status === 'Installing') return 'brand'
                            return 'informative'
                          })()}
                          appearance="filled"
                        >
                          {(() => {
                            const status = downloadStatusMap.get(game.releaseName || '')?.status
                            if (game.isInstalled) return 'Installed'
                            if (status === 'Completed') return 'Downloaded'
                            if (status === 'InstallError') return 'Install Error'
                            if (status === 'Installing') return 'Installing'
                            return 'Not Installed'
                          })()}
                        </Badge>
                        {game.hasUpdate && (
                          <Badge shape="rounded" color="brand" appearance="filled">
                            Update Available
                          </Badge>
                        )}
                      </div>
                      <div className={styles.inlineInfo}>
                        <DocumentDataRegular fontSize={16} />
                        <Text size={300}>{game.size || '-'}</Text>
                      </div>
                      <div className={styles.inlineInfo}>
                        <DownloadIcon fontSize={16} />
                        <Text size={300}>{game.downloads?.toLocaleString() || '-'}</Text>
                      </div>
                    </div>
                  </div>
                  <Divider />
                  <div className={styles.detailList}>
                    <div className={styles.inlineInfo}>
                      <InfoRegular fontSize={16} />
                      <Text>
                        {game.version ? `v${game.version}` : '-'}
                        {game.isInstalled &&
                          game.deviceVersionCode &&
                          ` (Device: v${game.deviceVersionCode})`}
                      </Text>
                    </div>
                    <div className={styles.inlineInfo}>
                      <TagRegular fontSize={16} />
                      <Text>{game.releaseName || '-'}</Text>
                    </div>
                    <div className={styles.inlineInfo}>
                      <CalendarClockRegular fontSize={16} />
                      <Text>{game.lastUpdated || '-'}</Text>
                    </div>
                  </div>
                </div>
              </div>
              <Divider style={{ marginTop: tokens.spacingVerticalS }} />
              <div className={styles.noteSection}>
                <Text weight="semibold" className={styles.noteTitle}>
                  Note:
                </Text>
                {loadingNote ? (
                  <Spinner size="tiny" label="Loading note..." />
                ) : currentGameNote ? (
                  <div className={styles.noteContent}>{currentGameNote}</div>
                ) : (
                  <Text>No note available.</Text>
                )}
              </div>
              <div className={styles.actionsList}>{renderActionButtons(game)}</div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" onClick={handleClose}>
                  Close
                </Button>
              </DialogTrigger>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={isDeleteConfirmOpen}
        onOpenChange={(_e, data) => !data.open && setIsDeleteConfirmOpen(false)}
        modalType="alert"
      >
        <DialogSurface mountNode={document.getElementById('portal')}>
          <DialogBody>
            <DialogTitle>Confirm Uninstall</DialogTitle>
            <div className={styles.deleteConfirmText}>
              Are you sure you want to uninstall
              <strong> {game?.name} </strong>({game?.packageName})? This will also remove associated
              OBB and Data files from the device.
            </div>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
                  Cancel
                </Button>
              </DialogTrigger>
              <Button appearance="primary" onClick={handleConfirmDeleteInternal}>
                Uninstall
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  )
}

export default GameDetailsDialog
