import type { Sandbox } from '@cloudflare/sandbox';
import type { OpenClawEnv } from '../types';
import { R2_MOUNT_PATH, getR2BucketName } from '../config';

/**
 * Check if R2 is already mounted by looking at the mount table
 */
async function isR2Mounted(sandbox: Sandbox): Promise<boolean> {
  try {
    const proc = await sandbox.startProcess(`mount | grep "s3fs on ${R2_MOUNT_PATH}"`);
    // Wait for the command to complete
    let attempts = 0;
    while (proc.status === 'running' && attempts < 10) {
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    const logs = await proc.getLogs();
    // If stdout has content, the mount exists
    const mounted = !!(logs.stdout && logs.stdout.includes('s3fs'));
    console.log('isR2Mounted check:', mounted, 'stdout:', logs.stdout?.slice(0, 100));
    return mounted;
  } catch (err) {
    console.log('isR2Mounted error:', err);
    return false;
  }
}

/**
 * Mount R2 bucket for persistent storage
 * 
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @returns true if mounted successfully, false otherwise
 */
export async function mountR2Storage(sandbox: Sandbox, env: OpenClawEnv): Promise<boolean> {
  // Skip if R2 credentials are not configured
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.CF_ACCOUNT_ID) {
    console.log('R2 storage not configured (missing R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, or CF_ACCOUNT_ID)');
    return false;
  }

  // Check if already mounted first - this avoids errors and is faster
  if (await isR2Mounted(sandbox)) {
    console.log('R2 bucket already mounted at', R2_MOUNT_PATH);
    return true;
  }

  // Clear mount point if it has stale content (not mounted but has leftover files)
  // This works around s3fs "not empty" error when the SDK doesn't support nonempty option
  try {
    console.log('Clearing mount point before R2 mount...');
    const clearProc = await sandbox.startProcess(`rm -rf ${R2_MOUNT_PATH} && mkdir -p ${R2_MOUNT_PATH}`);
    // Wait for clear to complete
    let attempts = 0;
    while (clearProc.status === 'running' && attempts < 20) {
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    const clearLogs = await clearProc.getLogs();
    console.log('Clear mount point result:', clearProc.status, 'stdout:', clearLogs.stdout, 'stderr:', clearLogs.stderr);
  } catch (err) {
    console.log('Could not clear mount point:', err);
  }

  const bucketName = getR2BucketName(env);
  try {
    console.log('Mounting R2 bucket', bucketName, 'at', R2_MOUNT_PATH);
    await sandbox.mountBucket(bucketName, R2_MOUNT_PATH, {
      endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      // Pass credentials explicitly since we use R2_* naming instead of AWS_*
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      // Allow mounting over non-empty directory (may have leftover data from previous mount)
      s3fsOptions: ['nonempty'],
    });
    console.log('R2 bucket mounted successfully - openclaw data will persist across sessions');
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log('R2 mount error:', errorMessage);
    
    // If error indicates already mounted, treat as success
    if (errorMessage.toLowerCase().includes('already mounted') || 
        errorMessage.toLowerCase().includes('already exists') ||
        errorMessage.toLowerCase().includes('mount point is busy')) {
      console.log('R2 bucket appears to be already mounted (from error message)');
      return true;
    }
    
    // Check again if it's mounted - the error might be misleading
    if (await isR2Mounted(sandbox)) {
      console.log('R2 bucket is mounted despite error');
      return true;
    }
    
    // Don't fail if mounting fails - openclaw can still run without persistent storage
    console.error('Failed to mount R2 bucket:', err);
    return false;
  }
}
