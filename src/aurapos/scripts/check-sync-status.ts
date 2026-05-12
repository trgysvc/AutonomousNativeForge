import { ElectricClient } from '@electric-sql/client';
import * as electricConfig from '../../../packages/electric-config';

async function main() {
  let createElectricClient: (() => ElectricClient) | undefined;

  if (typeof electricConfig.createElectricClient === 'function') {
    createElectricClient = electricConfig.createElectricClient;
  } else if (typeof electricConfig.default === 'function') {
    createElectricClient = electricConfig.default;
  } else {
    throw new Error('Could not find a function to create electric client in ../../../packages/electric-config');
  }

  try {
    const electric: ElectricClient = createElectricClient();
    const status = await electric.syncStatus();
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Unknown error');
    }
    process.exit(1);
  }
}

main();