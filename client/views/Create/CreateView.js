import { documentHasNestedEscapeLayer } from '../../shared/escapeLayers.js';
import template from './CreateView.html';
import '../../components/ProviderFields/ProviderModals.css';
import '../../components/ProviderFields/ProviderFields.css';
import './CreateView.css';
import { createTemplateFactory } from '../../utils/dom.js';
import { basicCreateMarkup } from './BasicCreateMarkup.js';
import { createCreateController } from './CreateController.js';

const createFragment = createTemplateFactory(template);
export const CreateView = Object.freeze({
 mount({ outlet, services, actions, creationId }) {
  outlet.append(createFragment('create-workflow'));
  const root = outlet.querySelector('.create-workflow-root');
  services.providers.document.setTitle(`${creationId ? 'Mutate' : 'Create'} - parascene beta`);
  const controller = createCreateController({
   root, creationId, markup: basicCreateMarkup(), providers: services.providers, actions,
   renderError(error) { const message = document.createElement('p'); message.setAttribute('role', 'alert'); message.textContent = error.message || 'Could not load Create.'; root.replaceChildren(message); },
  });
  return {
   backgroundReady: controller.ready,
   hasOpenEscapeTarget: () => documentHasNestedEscapeLayer(root),
   update: controller.update,
   destroy: controller.destroy,
  };
 },
});
