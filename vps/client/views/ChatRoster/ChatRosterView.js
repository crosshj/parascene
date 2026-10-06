// The roster is the persistent shell Sidebar; this route never mounts a second one.
export const ChatRosterView = {
	mount({ outlet }) {
		const message = document.createElement('p');
		message.textContent = 'Choose a conversation from the sidebar.';
		outlet.replaceChildren(message);
		return { destroy() { message.remove(); } };
	},
};
