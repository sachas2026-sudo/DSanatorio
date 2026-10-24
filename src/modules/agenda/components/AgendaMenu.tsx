import { useState } from 'react';
import { useConfirm } from '../../../context/ConfirmContext';

export type AgendaMenuItem = {
  id: string;
  label: string;
  onClick: () => void;
};

export function AgendaMenu({ onClose }: { onClose: () => void }) {
  const { confirm } = useConfirm();
  const [menuItems, setMenuItems] = useState<AgendaMenuItem[]>([
    {
      id: 'sin-turno',
      label: 'Sin turno',
      onClick: () => {
        // Manejar el clic en "Sin turno"
        // Podría abrir un modal o cambiar la vista
        console.log('Clic en "Sin turno"');
      },
    },
    {
      id: 'agenda-medico',
      label: 'Agenda médico',
      onClick: () => {
        // Manejar el clic en "Agenda médico"
        // Podría abrir un modal o cambiar la vista
        console.log('Clic en "Agenda médico"');
      },
    },
    {
      id: 'horarios',
      label: 'Horarios',
      onClick: () => {
        // Manejar el clic en "Horarios"
        // Podría abrir un modal o cambiar la vista
        console.log('Clic en "Horarios"');
      },
    },
    {
      id: 'franja-turno',
      label: 'Franja turno',
      onClick: () => {
        // Manejar el clic en "Franja turno"
        // Podría abrir un modal o cambiar la vista
        console.log('Clic en "Franja turno"');
      },
    },
    {
      id: 'dias-libres',
      label: 'Días libres',
      onClick: () => {
        // Manejar el clic en "Días libres"
        // Podría abrir un modal o cambiar la vista
        console.log('Clic en "Días libres"');
      },
    },
    {
      id: 'especialidades',
      label: 'Especialidades',
      onClick: () => {
        // Manejar el clic en "Especialidades"
        // Podría abrir un modal o cambiar la vista
        console.log('Clic en "Especialidades"');
      },
    },
    {
      id: 'medicos-hoy',
      label: 'Médicos hoy',
      onClick: () => {
        // Manejar el clic en "Médicos hoy"
        // Podría abrir un modal o cambiar la vista
        console.log('Clic en "Médicos hoy"');
      },
    },
  ]);

  return (
    <div className="booking-patient-picker__menu">
      {menuItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className="booking-patient-picker__opt"
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}