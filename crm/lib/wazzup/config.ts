export interface WazzupChannel {
  id: string;
  plainId: string;
  label: string;
}

export const WAZZUP_CHANNELS: WazzupChannel[] = [
  {
    id: '40843839-f38c-4ea2-8096-1b4c44fd6dce',
    plainId: '77057618170',
    label: '+7 (705) 761-81-70'
  },
  {
    id: '1d1896704e8a4fa385703445d4943b56',
    plainId: '77011234567', // Замените на реальный plainId (номер телефона) второго канала при необходимости
    label: '+7 (701) 123-45-67' // Замените на реальный номер второго канала, который будет отображаться на вкладке
  }
];
