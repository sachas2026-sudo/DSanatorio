import type { Doctor } from '../../../types'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useState } from 'react'
import './medicos-dia-modal.css'

type Props = {
  isOpen: boolean
  onClose: () => void
  doctors: Doctor[]
  selectedDate: Date | null
}

export function MedicosDiaModal({ isOpen, onClose, doctors, selectedDate }: Props) {
  const [showPdfPreview, setShowPdfPreview] = useState(false)
  if (!isOpen) return null

  const selectedDateLabel = selectedDate
    ? format(selectedDate, "EEEE d 'de' MMMM yyyy", { locale: es })
    : 'Fecha no seleccionada'

  return (
    <div className="modal-overlay modal-overlay--modern" onClick={onClose}>
      <div className="modal modal--medicos-dia modal--modern" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header modal__header--modern">
          <div className="modal__header-content">
            <div className="modal__header-icon">👨‍⚕️</div>
            <div className="modal__header-text">
              <h2 className="modal__title">
                Médicos Disponibles - <span style={{ fontWeight: 'normal', fontSize: '0.85em' }}>{selectedDateLabel}</span>
              </h2>
            </div>
          </div>
          <button type="button" className="modal__close modal__close--modern" onClick={onClose} aria-label="Cerrar">
            <span className="modal__close-icon">✕</span>
          </button>
        </div>
        <div className="modal__body modal__body--modern">
          {doctors.length === 0 ? (
            <div className="medicos-dia__empty medicos-dia__empty--modern">
              <div className="medicos-dia__empty-illustration">
                <div className="medicos-dia__empty-circle">
                  <span className="medicos-dia__empty-emoji">�</span>
                </div>
              </div>
              <h3 className="medicos-dia__empty-title">Sin médicos disponibles</h3>
              <p className="medicos-dia__empty-text">No hay médicos programados para este día</p>
            </div>
          ) : (
            <div className="medicos-dia__grid medicos-dia__grid--modern">
              {doctors.map((doctor) => (
                <div key={doctor.id} className="medicos-dia__card medicos-dia__card--modern">
                  <div className="medicos-dia__card-header medicos-dia__card-header--modern">
                    <div className="medicos-dia__avatar medicos-dia__avatar--modern">
                      {doctor.nombre.charAt(0)}{doctor.apellido.charAt(0)}
                    </div>
                    <div className="medicos-dia__info medicos-dia__info--modern">
                      <div className="medicos-dia__nombre medicos-dia__nombre--modern">
                        {doctor.apellido}, {doctor.nombre}
                      </div>
                      {doctor.especialidad && (
                        <div className="medicos-dia__especialidad medicos-dia__especialidad--modern">
                          {doctor.especialidad}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="medicos-dia__card-body medicos-dia__card-body--modern">
                    {doctor.telefono && (
                      <div className="medicos-dia__contact medicos-dia__contact--modern">
                        <div className="medicos-dia__contact-icon">📞</div>
                        <div className="medicos-dia__contact-value">{doctor.telefono}</div>
                      </div>
                    )}
                    {doctor.obrasSociales && doctor.obrasSociales.length > 0 && (
                      <div className="medicos-dia__obras medicos-dia__obras--modern">
                        <div className="medicos-dia__obras-icon">🏥</div>
                        <div className="medicos-dia__obras-list">
                          {doctor.obrasSociales.map((os, idx) => (
                            <span key={idx} className="medicos-dia__obra medicos-dia__obra--modern">
                              {os}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal__footer modal__footer--modern">
          <div className="medicos-dia__summary medicos-dia__summary--modern">
            <span className="medicos-dia__summary-icon">✨</span>
            <span className="medicos-dia__summary-text">
              {doctors.length} médico{doctors.length === 1 ? '' : 's'} disponible{doctors.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="medicos-dia__actions">
            <button
              type="button"
              className="btn btn-pdf btn--modern"
              onClick={() => setShowPdfPreview(true)}
            >
              PDF
            </button>
            <button type="button" className="btn btn-primary btn--modern" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
      {showPdfPreview && (
        <div className="modal-overlay modal-overlay--modern" onClick={() => setShowPdfPreview(false)}>
          <div className="modal modal--pdf-preview modal--modern" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header modal__header--modern">
              <h2 className="modal__title">Vista previa PDF</h2>
              <button type="button" className="modal__close modal__close--modern" onClick={() => setShowPdfPreview(false)} aria-label="Cerrar">
                <span className="modal__close-icon">✕</span>
              </button>
            </div>
            <div className="modal__body modal__body--modern">
              <div className="pdf-preview-cards">
                {doctors.map((doctor) => (
                  <div key={doctor.id} className="pdf-preview-card">
                    <div className="pdf-preview-card__header">
                      <div className="pdf-preview-card__avatar">
                        {doctor.nombre.charAt(0)}{doctor.apellido.charAt(0)}
                      </div>
                      <div>
                        <h4>{doctor.apellido}, {doctor.nombre}</h4>
                        <span>{doctor.especialidad || '—'}</span>
                      </div>
                    </div>
                    <div className="pdf-preview-card__body">
                      <p><strong>Contacto:</strong> {doctor.telefono || '—'}</p>
                      {doctor.obrasSociales && doctor.obrasSociales.length > 0 && (
                        <p><strong>Obras sociales:</strong> {doctor.obrasSociales.join(', ')}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal__footer modal__footer--modern">
              <button type="button" className="btn btn-pdf btn--modern" onClick={() => window.print()}>
                Imprimir
              </button>
              <button type="button" className="btn btn-primary btn--modern" onClick={() => setShowPdfPreview(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
