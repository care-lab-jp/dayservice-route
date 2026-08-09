/**
 * デモ用の架空データ。実在の人物・住所とは一切関係ありません。
 * 座標も架空の位置です。
 */
import type { Facility, Member, Vehicle } from '../types';

export const sampleFacility: Facility = {
  id: 'fac-1',
  name: 'さくらデイサービスセンター',
  postalCode: '000-0000',
  address: '兵庫県さくら市みどり町1-1（架空）',
  lat: 34.815,
  lng: 134.685,
  arriveBy: '09:15',
};

export const sampleVehicles: Vehicle[] = [
  { id: 'car-a', name: '車両A', capacity: 8, wheelchair: true, active: true },
  { id: 'car-b', name: '車両B', capacity: 5, wheelchair: false, active: false },
];

export const sampleMembers: Member[] = [
  {
    id: 'm-1', name: '田中', postalCode: '000-0001', address: '兵庫県さくら市ひまわり町2-3（架空）',
    lat: 34.8235, lng: 134.679,
    pickupFrom: '08:10', pickupTo: '08:40', dropoffFrom: '16:00', dropoffTo: '16:40',
    boardingMinutes: 5, maxRideMinutes: 35, requiresWheelchair: true,
    note: '車いす。玄関前まで介助が必要。', active: true,
  },
  {
    id: 'm-2', name: '山田', postalCode: '000-0002', address: '兵庫県さくら市あおば町5-12（架空）',
    lat: 34.828, lng: 134.6935,
    pickupFrom: '08:10', pickupTo: '08:45', dropoffFrom: '16:00', dropoffTo: '16:45',
    boardingMinutes: 3, note: '玄関前で待っていることが多い。', active: true,
  },
  {
    id: 'm-3', name: '鈴木', postalCode: '000-0003', address: '兵庫県さくら市かえで町1-8（架空）',
    lat: 34.809, lng: 134.7,
    pickupFrom: '08:15', pickupTo: '08:50', dropoffFrom: '16:10', dropoffTo: '16:50',
    boardingMinutes: 5, maxRideMinutes: 40, note: '歩行器使用。', active: true,
  },
  {
    id: 'm-4', name: '佐藤', postalCode: '000-0004', address: '兵庫県さくら市うめの台3-4（架空）',
    lat: 34.8035, lng: 134.676,
    pickupFrom: '08:10', pickupTo: '09:00', dropoffFrom: '16:00', dropoffTo: '16:50',
    boardingMinutes: 2, note: '', active: true,
  },
  {
    id: 'm-5', name: '高橋', postalCode: '000-0005', address: '兵庫県さくら市きたやま2-1（架空）',
    lat: 34.818, lng: 134.669,
    pickupFrom: '08:15', pickupTo: '09:00', dropoffFrom: '16:05', dropoffTo: '16:45',
    boardingMinutes: 4, note: '家族への声かけが必要。', active: true,
  },
];
