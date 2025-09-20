const Icon = (props) => (
  <span className={`material-symbols-outlined${props.className ? ' ' + props.className : ''}`} style={props.style}>
    {props.name}
  </span>
)
export default Icon
