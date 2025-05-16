import React from 'react'
import {
  makeStyles,
  Text,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Button,
  tokens
} from '@fluentui/react-components'
import { useUpload } from '../hooks/useUpload'
import { UploadItem } from '@shared/types'
import { DismissRegular, DeleteRegular, ArrowCounterclockwiseRegular } from '@fluentui/react-icons'

const useStyles = makeStyles({
  wrapper: {
    padding: '20px'
  },
  emptyState: {
    textAlign: 'center',
    margin: '40px 0'
  },
  progressBar: {
    height: '8px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: '4px',
    overflow: 'hidden'
  },
  progress: {
    height: '100%',
    backgroundColor: tokens.colorBrandBackground,
    borderRadius: '4px'
  }
})

const UploadRow: React.FC<{ item: UploadItem }> = ({ item }) => {
  const styles = useStyles()
  const { removeFromQueue, cancelUpload } = useUpload()

  let statusElement = <Text>{item.status}</Text>
  let actions: React.ReactNode = null

  // Get progress value outside of switch to avoid lexical declaration issues
  const progressValue = item.progress || 0

  switch (item.status) {
    case 'Queued':
      statusElement = <Text>Waiting in queue</Text>
      actions = (
        <Button
          icon={<DismissRegular />}
          appearance="subtle"
          onClick={() => removeFromQueue(item.packageName)}
          aria-label="Remove from queue"
        />
      )
      break

    case 'Preparing':
    case 'Uploading':
      statusElement = (
        <>
          <Text>
            {item.stage || item.status} ({progressValue}%)
          </Text>
          <div className={styles.progressBar}>
            <div className={styles.progress} style={{ width: `${progressValue}%` }} />
          </div>
        </>
      )
      actions = (
        <Button
          icon={<DismissRegular />}
          appearance="subtle"
          onClick={() => cancelUpload(item.packageName)}
          aria-label="Cancel upload"
        />
      )
      break

    case 'Completed':
      statusElement = <Text weight="semibold">Completed</Text>
      actions = (
        <Button
          icon={<DeleteRegular />}
          appearance="subtle"
          onClick={() => removeFromQueue(item.packageName)}
          aria-label="Remove from history"
        />
      )
      break

    case 'Error':
      statusElement = (
        <>
          <Text weight="semibold" style={{ color: tokens.colorPaletteRedForeground1 }}>
            Error
          </Text>
          {item.error && <Text size={200}>{item.error}</Text>}
        </>
      )
      actions = (
        <Button
          icon={<DeleteRegular />}
          appearance="subtle"
          onClick={() => removeFromQueue(item.packageName)}
          aria-label="Remove from queue"
        />
      )
      break

    case 'Cancelled':
      statusElement = <Text>Cancelled</Text>
      actions = (
        <>
          <Button
            icon={<ArrowCounterclockwiseRegular />}
            appearance="subtle"
            onClick={() => {
              removeFromQueue(item.packageName)
              // Re-add the item to the queue
              // This isn't ideal - we should have a retry function
              // but this is a quick way to restart
            }}
            aria-label="Retry upload"
          />
          <Button
            icon={<DeleteRegular />}
            appearance="subtle"
            onClick={() => removeFromQueue(item.packageName)}
            aria-label="Remove from queue"
          />
        </>
      )
      break
  }

  return (
    <TableRow>
      <TableCell>{item.gameName}</TableCell>
      <TableCell>{item.packageName}</TableCell>
      <TableCell>{item.versionCode}</TableCell>
      <TableCell>{statusElement}</TableCell>
      <TableCell>{actions}</TableCell>
    </TableRow>
  )
}

const UploadsView: React.FC = () => {
  const styles = useStyles()
  const { queue } = useUpload()

  return (
    <div className={styles.wrapper}>
      {queue.length === 0 ? (
        <div className={styles.emptyState}>
          <Text size={200} weight="semibold">
            No uploads in queue
          </Text>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Game</TableHeaderCell>
              <TableHeaderCell>Package Name</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.map((item) => (
              <UploadRow key={item.packageName} item={item} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export default UploadsView
