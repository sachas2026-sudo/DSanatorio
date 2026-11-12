CREATE TABLE doctor_honorarios (
  doctor_id TEXT PRIMARY KEY NOT NULL,
  porcentaje REAL,
  valor INTEGER,
  particular INTEGER,
  cuidar INTEGER,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

INSERT INTO doctor_honorarios (doctor_id, porcentaje, valor, particular, cuidar)
SELECT id, porcentaje, valor, particular, cuidar
FROM doctors;
