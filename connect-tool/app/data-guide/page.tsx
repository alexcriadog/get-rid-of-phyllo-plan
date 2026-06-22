import type { Metadata } from 'next';
import guide from './guide.json';
import { DataGuideExplorer } from './DataGuideExplorer';
import type { GuideData } from './types';

export const metadata: Metadata = {
  title: 'Data Guide — Camaleonic Connect',
};

export default function DataGuidePage() {
  return <DataGuideExplorer guide={guide as GuideData} />;
}
