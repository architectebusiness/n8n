import { Notification, Message, Dialog } from 'element-ui';
import type { ElNotificationComponent, ElNotificationOptions } from 'element-ui/types/notification';
import type { ElMessageComponent, ElMessageOptions, MessageType } from 'element-ui/types/message';
import type { ElMessageBoxOptions } from 'element-ui/types/message-box';
import type { IExecuteContextData, IRunExecutionData } from 'n8n-workflow';
import { useExternalHooks } from '@/composables/useExternalHooks';
import { useWorkflowsStore } from '@/stores';
import { useTelemetry } from '@/composables/useTelemetry';
import { sanitizeHtml } from '@/utils';
import { i18n as locale } from '@/plugins/i18n';

let stickyNotificationQueue: ElNotificationComponent[] = [];

export function useShowMessage() {
	const externalHooks = useExternalHooks();
	const workflowsStore = useWorkflowsStore();
	const telemetry = useTelemetry();

	const causedByCredential = (message: string | undefined) => {
		if (!message) return false;

		return message.includes('Credentials for') && message.includes('are not set');
	};

	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore-next-line
	const collapsableDetails = ({ description, node }: Error) => {
		if (!description) return '';

		const errorDescription =
			description.length > 500 ? `${description.slice(0, 500)}...` : description;

		return `
				<br>
				<br>
				<details>
					<summary
						style="color: #ff6d5a; font-weight: bold; cursor: pointer;"
					>
						${locale.baseText('showMessage.showDetails')}
					</summary>
					<p>${node.name}: ${errorDescription}</p>
				</details>
			`;
	};

	const clearAllStickyNotifications = () => {
		stickyNotificationQueue.map((notification: ElNotificationComponent) => {
			if (notification) {
				notification.close();
			}
		});

		stickyNotificationQueue = [];
	};

	const showMessage = (
		messageData: Omit<ElNotificationOptions, 'message'> & { message?: string },
		track = true,
	) => {
		messageData.dangerouslyUseHTMLString = true;
		messageData.message = messageData.message
			? sanitizeHtml(messageData.message)
			: messageData.message;

		if (messageData.position === undefined) {
			messageData.position = 'bottom-right';
		}

		const notification = Notification(messageData as ElNotificationOptions);

		if (messageData.duration === 0) {
			stickyNotificationQueue.push(notification);
		}

		if (messageData.type === 'error' && track) {
			telemetry.track('Instance FE emitted error', {
				error_title: messageData.title,
				error_message: messageData.message,
				caused_by_credential: causedByCredential(messageData.message),
				workflow_id: workflowsStore.workflowId,
			});
		}

		return notification;
	};

	const showToast = (config: {
		title: string;
		message: string;
		onClick?: () => void;
		onClose?: () => void;
		duration?: number;
		customClass?: string;
		closeOnClick?: boolean;
		type?: MessageType;
	}) => {
		const notification = showMessage({
			title: config.title,
			message: config.message,
			onClick: config.onClick,
			onClose: config.onClose,
			duration: config.duration,
			customClass: config.customClass,
			type: config.type,
		});

		if (config.closeOnClick) {
			const cb = config.onClick;
			config.onClick = () => {
				notification?.close?.();
				if (cb) {
					cb();
				}
			};
		}

		return notification;
	};

	const showAlert = (config: ElMessageOptions): ElMessageComponent => Message(config);

	const getExecutionError = (data: IRunExecutionData | IExecuteContextData) => {
		const error = data.resultData.error;

		let errorMessage: string;

		if (data.resultData.lastNodeExecuted && error) {
			errorMessage = error.message || error.description;
		} else {
			errorMessage = 'There was a problem executing the workflow!';

			if (error && error.message) {
				let nodeName: string | undefined;
				if ('node' in error) {
					nodeName = typeof error.node === 'string' ? error.node : error.node!.name;
				}

				const receivedError = nodeName ? `${nodeName}: ${error.message}` : error.message;
				errorMessage = `There was a problem executing the workflow:<br /><strong>"${receivedError}"</strong>`;
			}
		}

		return errorMessage;
	};

	const showError = (e: Error | unknown, title: string, message?: string) => {
		const error = e as Error;
		const messageLine = message ? `${message}<br/>` : '';
		showMessage(
			{
				title,
				message: `
					${messageLine}
					<i>${error.message}</i>
					${collapsableDetails(error)}`,
				type: 'error',
				duration: 0,
			},
			false,
		);

		externalHooks.run('showMessage.showError', {
			title,
			message,
			errorMessage: error.message,
		});

		telemetry.track('Instance FE emitted error', {
			error_title: title,
			error_description: message,
			error_message: error.message,
			caused_by_credential: causedByCredential(error.message),
			workflow_id: workflowsStore.workflowId,
		});
	};

	const confirmMessage = async (
		message: string,
		headline: string,
		type: MessageType | null = 'warning',
		confirmButtonText?: string,
		cancelButtonText?: string,
	): Promise<boolean> => {
		try {
			const options: ElMessageBoxOptions = {
				confirmButtonText: confirmButtonText || locale.baseText('showMessage.ok'),
				cancelButtonText: cancelButtonText || locale.baseText('showMessage.cancel'),
				dangerouslyUseHTMLString: true,
				...(type && { type }),
			};

			const sanitizedMessage = sanitizeHtml(message);
			await new Dialog().$confirm(sanitizedMessage, headline, options);
			return true;
		} catch (e) {
			return false;
		}
	};

	const confirmModal = async (
		message: string,
		headline: string,
		type: MessageType | null = 'warning',
		confirmButtonText?: string,
		cancelButtonText?: string,
		showClose = false,
	): Promise<string> => {
		try {
			const options: ElMessageBoxOptions = {
				confirmButtonText: confirmButtonText || locale.baseText('showMessage.ok'),
				cancelButtonText: cancelButtonText || locale.baseText('showMessage.cancel'),
				dangerouslyUseHTMLString: true,
				showClose,
				...(type && { type }),
			};

			const sanitizedMessage = sanitizeHtml(message);
			await new Dialog().$confirm(sanitizedMessage, headline, options);
			return 'confirmed';
		} catch (e) {
			return e as string;
		}
	};

	return {
		clearAllStickyNotifications,
		showMessage,
		showToast,
		showAlert,
		getExecutionError,
		showError,
		confirmMessage,
		confirmModal,
	};
}
