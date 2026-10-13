import { configure } from '@testing-library/react'

// Full-suite runs execute many jsdom files in parallel; findBy* needs headroom there.
configure({ asyncUtilTimeout: 5000 })
