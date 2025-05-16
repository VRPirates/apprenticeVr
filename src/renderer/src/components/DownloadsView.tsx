import React from 'react'
import { useDownload } from '../hooks/useDownload'
import {
  makeStyles,
  tokens,
  Title2,
  Text,
  Button,
  ProgressBar,
  Image
} from '@fluentui/react-components'
import {
  DeleteRegular,
  DismissRegular as CloseIcon,
  ArrowCounterclockwiseRegular as RetryIcon
} from '@fluentui/react-icons'
import { formatDistanceToNow } from 'date-fns'
import placeholderImage from '../assets/images/game-placeholder.png'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    padding: tokens.spacingHorizontalXXL,
    gap: tokens.spacingVerticalL
  },
  itemRow: {
    display: 'grid',
    gridTemplateColumns: '60px 1fr auto auto', // Thumbnail, Info, Progress/Status, Actions
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    paddingTop: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`
  },
  thumbnail: {
    width: '60px',
    height: '60px',
    objectFit: 'cover'
  },
  gameInfo: {
    display: 'flex',
    flexDirection: 'column'
  },
  progressStatus: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: tokens.spacingVerticalXS,
    width: '150px' // Fixed width for progress/status text
  },
  progressBar: {
    width: '100%'
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS
  },
  errorText: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200
  },
  statusText: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2
  }
})

const DownloadsView: React.FC = () => {
  console.log('[DownloadsView] Rendering')
  const styles = useStyles()
  const { queue, isLoading, error, removeFromQueue, cancelDownload, retryDownload } = useDownload()

  const formatAddedTime = (timestamp: number): string => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
    } catch (e: unknown) {
      console.error('Error formatting date:', e)
      return 'Invalid date'
    }
  }

  if (isLoading) {
    return <div className={styles.root}>Loading download queue...</div>
  }

  if (error) {
    return (
      <div className={styles.root}>
        <Title2>Downloads</Title2>
        <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
          Error loading queue: {error}
        </Text>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {queue.length === 0 ? (
        <Text>Download queue is empty.</Text>
      ) : (
        <div>
          {queue
            .sort((a, b) => b.addedDate - a.addedDate)
            .map((item) => (
              <div key={item.releaseName} className={styles.itemRow}>
                {/* Thumbnail */}
                <Image
                  src={item.thumbnailPath ? `file://${item.thumbnailPath}` : placeholderImage}
                  alt={`${item.gameName} thumbnail`}
                  className={styles.thumbnail}
                  shape="rounded"
                  fit="cover"
                />
                {/* Game Info */}
                <div className={styles.gameInfo}>
                  <Text weight="semibold">{item.gameName}</Text>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                    {item.releaseName}
                  </Text>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    Added: {formatAddedTime(item.addedDate)}
                  </Text>
                </div>
                {/* Progress / Status */}
                <div className={styles.progressStatus}>
                  {item.status === 'Downloading' && (
                    <>
                      <ProgressBar value={item.progress / 100} className={styles.progressBar} />
                      <Text className={styles.statusText}>{item.progress}%</Text>
                      {item.speed && (
                        <Text size={200} className={styles.statusText}>
                          Speed: {item.speed}
                        </Text>
                      )}
                      {item.eta &&
                        item.eta !== '-' && ( // Don't show ETA if it's just '-'
                          <Text size={200} className={styles.statusText}>
                            ETA: {item.eta}
                          </Text>
                        )}
                    </>
                  )}
                  {/* Added Extraction Progress Display */}
                  {item.status === 'Extracting' && (
                    <>
                      <ProgressBar
                        value={(item.extractProgress || 0) / 100}
                        className={styles.progressBar}
                      />
                      <Text className={styles.statusText}>
                        Extracting... {item.extractProgress || 0}%
                      </Text>
                    </>
                  )}
                  {item.status === 'Installing' && (
                    <Text className={styles.statusText}>Installing...</Text>
                  )}
                  {item.status === 'Queued' && <Text className={styles.statusText}>Queued</Text>}
                  {item.status === 'Completed' && (
                    <Text style={{ color: tokens.colorPaletteGreenForeground1 }}>Completed</Text>
                  )}
                  {item.status === 'Cancelled' && (
                    <Text className={styles.statusText}>Cancelled</Text>
                  )}
                  {item.status === 'Error' && (
                    <>
                      <Text className={styles.errorText}>Error</Text>
                      {item.error && (
                        <Text size={200} className={styles.errorText} title={item.error}>
                          {item.error.substring(0, 30)}...
                        </Text>
                      )}
                    </>
                  )}
                  {item.status === 'InstallError' && (
                    <>
                      <Text className={styles.errorText}>Install Error</Text>
                      {item.error && (
                        <Text size={200} className={styles.errorText} title={item.error}>
                          {item.error.substring(0, 30)}...
                        </Text>
                      )}
                    </>
                  )}
                </div>
                {/* Actions */}
                <div className={styles.actions}>
                  {/* Cancel Button */}
                  {(item.status === 'Queued' ||
                    item.status === 'Downloading' ||
                    item.status === 'Extracting' ||
                    item.status === 'Installing') && (
                    <Button
                      icon={<CloseIcon />}
                      aria-label="Cancel"
                      size="small"
                      appearance="subtle"
                      onClick={() => cancelDownload(item.releaseName)}
                      title="Cancel"
                    />
                  )}

                  {/* Retry Button */}
                  {(item.status === 'Cancelled' ||
                    item.status === 'Error' ||
                    item.status === 'InstallError') && (
                    <Button
                      icon={<RetryIcon />}
                      aria-label="Retry download"
                      size="small"
                      appearance="subtle"
                      onClick={() => retryDownload(item.releaseName)}
                      title="Retry"
                    />
                  )}

                  {/* Remove Button (appears when not actively downloading/extracting/installing) */}
                  {(item.status === 'Completed' ||
                    item.status === 'Cancelled' ||
                    item.status === 'Error' ||
                    item.status === 'InstallError' ||
                    item.status === 'Queued') && (
                    <Button
                      icon={<DeleteRegular />}
                      aria-label="Remove from list and delete files"
                      size="small"
                      appearance="subtle"
                      onClick={() => removeFromQueue(item.releaseName)}
                      title="Remove from list and delete files"
                    />
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

export default DownloadsView
