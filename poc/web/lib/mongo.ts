import { MongoClient, Db } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/connector_ui';

// Cache the client across hot reloads in dev.
declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClient(): Promise<MongoClient> {
  if (!global.__mongoClientPromise) {
    const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 2000 });
    global.__mongoClientPromise = client.connect();
  }
  return global.__mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db('connector_ui');
}

export async function safeCollection<T = any>(name: string): Promise<T[]> {
  try {
    const db = await getDb();
    const docs = (await db.collection(name).find({}).limit(500).toArray()) as unknown as T[];
    return docs;
  } catch (err) {
    console.error(`[mongo] failed to read collection ${name}:`, (err as Error).message);
    return [];
  }
}
