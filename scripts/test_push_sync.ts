import sqlite3 from 'sqlite3'
import { calcularResumenDiario } from './src/lib/resumenDiario'
import { pushResumenDiarioToSupabase, pushHistorialResumenesToSupabase } from './src/lib/supabaseSync'

console.log('Testing push functions directly from TypeScript...')

