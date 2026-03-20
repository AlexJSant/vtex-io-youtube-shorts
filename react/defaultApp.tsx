import React from 'react'

type Props = {
  name?: string
}

function Greeting({ name }: Props) {
  return <div>Hey, {name || 'VTEX'}</div>
}

export default Greeting
