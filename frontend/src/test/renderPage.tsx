import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { LibraryProvider } from '../library'

/** Shows the current location so tests can assert on navigation. */
export function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

/**
 * Renders `element` at `route` inside the real LibraryProvider and a MemoryRouter.
 * Other routes render a stub so navigation can be observed.
 */
export function renderPage(element: ReactElement, { route = '/', path = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LibraryProvider>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<p>Other page</p>} />
        </Routes>
        <LocationProbe />
      </LibraryProvider>
    </MemoryRouter>,
  )
}
